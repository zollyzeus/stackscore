import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { judgeSubmission } from "../lib/judge";
import { computeScoreCard, rubricDefinition, type AxisId } from "../lib/scoring";
import { FIXTURES, type Band, type CalibrationFixture } from "../data/calibration/fixtures";
import { fingerprintOf } from "../lib/calibrationFingerprint";
import { JUDGE_MODEL, JUDGE_EFFORT } from "../lib/judge";
import rubric from "../data/rubric.json";

/**
 * Judge calibration sweep.
 *
 * Answers two questions that an assessment product cannot ship without answering:
 *   1. ACCURACY  - does the judge put a submission where a human grader would put it?
 *   2. RELIABILITY - does it put the same submission in the same place twice?
 *
 * (2) bounds (1). If the same submission swings 25 points between runs, no offset can fix
 * the score, because there is no stable score to correct. So the report leads with spread.
 *
 * This test calls the real Anthropic API and costs real money. It is skipped unless
 * RUN_CALIBRATION=1 so it can live in the normal suite without being billed on every run.
 *
 *   RUN_CALIBRATION=1 npx playwright test --project=calibration
 *   RUN_CALIBRATION=1 CALIBRATION_RUNS=3 npx playwright test --project=calibration
 *
 * Writes calibration-report.{md,json} to test-results/.
 */

const RUNS = Number(process.env.CALIBRATION_RUNS ?? 3);

/**
 * Guards on the offset recommendation. Without these the recommendation is worse than
 * useless, because it looks quantitative while being noise:
 *  - MIN_RUNS_FOR_OFFSET: with one run per fixture the within-fixture sd is 0 by
 *    construction, so every lean trivially "exceeds the noise floor".
 *  - MIN_FIXTURES_FOR_OFFSET: "all deviations share a sign" is unremarkable across 2-3
 *    fixtures; it is evidence only once there are enough points for the sign to mean
 *    something.
 *  - MIN_MEANINGFUL_LEAN: the bands are ~20-30 points wide and the ground truth is
 *    authored, so a lean of a few points is inside the resolution of the labels
 *    themselves. Correcting it would be fitting the product to my own guesses.
 */
const MIN_RUNS_FOR_OFFSET = 2;
const MIN_FIXTURES_FOR_OFFSET = 4;
const MIN_MEANINGFUL_LEAN = 5;
const CONCURRENCY = Number(process.env.CALIBRATION_CONCURRENCY ?? 4);
const ONLY = process.env.CALIBRATION_ONLY?.split(",").map((s) => s.trim()).filter(Boolean);

const AXIS_IDS: AxisId[] = rubricDefinition.levels.flatMap((l) =>
  l.axes.map((a) => a.id as AxisId),
);
const AXIS_LABEL: Record<string, string> = Object.fromEntries(
  rubricDefinition.levels.flatMap((l) => l.axes.map((a) => [a.id, a.label])),
);

interface RunResult {
  fixtureId: string;
  run: number;
  axisScores: Record<AxisId, number>;
  stackScore: number;
  error?: string;
}

// ---------------------------------------------------------------------------- stats

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample standard deviation (n-1). With RUNS=2 this is a crude estimate; it is still the
 *  honest one, and the report states n so the number is not over-read. */
function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

function mid(band: Band): number {
  return (band[0] + band[1]) / 2;
}

/** Signed distance outside the band: 0 if inside, negative if below, positive if above.
 *  Signed, because the direction is the whole point — a uniformly negative set of
 *  deviations is a correctable bias, a mixed set is noise. */
function deviation(value: number, band: Band): number {
  if (value < band[0]) return value - band[0];
  if (value > band[1]) return value - band[1];
  return 0;
}

/** Ordinary least squares of y on x. Used to test whether the judge's scale is compressed
 *  (slope well under 1) rather than merely shifted (slope ~1, intercept != 0). The
 *  distinction decides whether a per-axis offset or a linear rescale is the right fix. */
function linearFit(xs: number[], ys: number[]): { slope: number; intercept: number; r2: number } {
  const n = xs.length;
  const mx = mean(xs);
  const my = mean(ys);
  const sxy = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0);
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const ssTot = ys.reduce((a, y) => a + (y - my) ** 2, 0);
  const ssRes = ys.reduce((a, y, i) => a + (y - (slope * xs[i] + intercept)) ** 2, 0);
  return { slope, intercept, r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---------------------------------------------------------------------------- execution

async function runFixture(fx: CalibrationFixture, run: number): Promise<RunResult> {
  try {
    const { axisScores } = await judgeSubmission({ ...fx.submission, role: fx.role });
    const card = computeScoreCard(axisScores);
    return { fixtureId: fx.id, run, axisScores, stackScore: card.stackScore };
  } catch (err) {
    return {
      fixtureId: fx.id,
      run,
      axisScores: {} as Record<AxisId, number>,
      stackScore: NaN,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Bounded-concurrency map. Sequential would take ~30 x judge latency; unbounded would
 *  trip the API rate limit and the retries would distort the latency we are not measuring
 *  but would still pay for. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------------------- report

function buildReport(fixtures: CalibrationFixture[], results: RunResult[]) {
  const byFixture = new Map<string, RunResult[]>();
  for (const r of results) {
    if (!byFixture.has(r.fixtureId)) byFixture.set(r.fixtureId, []);
    byFixture.get(r.fixtureId)!.push(r);
  }

  const failed = results.filter((r) => r.error);
  const ok = results.filter((r) => !r.error);

  // --- per-fixture per-axis summary
  const perFixture = fixtures.map((fx) => {
    const runs = (byFixture.get(fx.id) ?? []).filter((r) => !r.error);
    const axes = AXIS_IDS.map((axis) => {
      const vals = runs.map((r) => r.axisScores[axis]).filter((v) => typeof v === "number");
      // Fall back to a hardAssertion band for this axis. Without this, an axis constrained
      // only by a rule (K6's mandated 50, F08's K4) shows as "asserted 0" in the per-axis
      // table and looks unmeasured when it is in fact the most tightly measured of all.
      const band = fx.expected[axis] ?? fx.hardAssertions?.find((h) => h.axis === axis)?.band;
      const m = vals.length ? mean(vals) : NaN;
      return {
        axis,
        label: AXIS_LABEL[axis],
        values: vals,
        mean: m,
        sd: vals.length ? sd(vals) : NaN,
        range: vals.length ? Math.max(...vals) - Math.min(...vals) : NaN,
        band: band ?? null,
        deviation: band && vals.length ? deviation(m, band) : null,
        inBand: band && vals.length ? deviation(m, band) === 0 : null,
      };
    });
    const ssVals = runs.map((r) => r.stackScore).filter((v) => Number.isFinite(v));
    const ssBand = fx.expected.stackScore;
    const ssMean = ssVals.length ? mean(ssVals) : NaN;
    return {
      id: fx.id,
      label: fx.label,
      role: fx.role,
      runs: runs.length,
      axes,
      stackScore: {
        values: ssVals,
        mean: ssMean,
        sd: ssVals.length ? sd(ssVals) : NaN,
        range: ssVals.length ? Math.max(...ssVals) - Math.min(...ssVals) : NaN,
        band: ssBand ?? null,
        deviation: ssBand && ssVals.length ? deviation(ssMean, ssBand) : null,
        inBand: ssBand && ssVals.length ? deviation(ssMean, ssBand) === 0 : null,
      },
      dissociation: fx.dissociation
        ? (() => {
            const meanOf = (ids: AxisId[]) => {
              const vs = ids.flatMap((id) =>
                runs.map((r) => r.axisScores[id]).filter((v) => typeof v === "number"),
              );
              return vs.length ? mean(vs) : NaN;
            };
            const holdsMean = meanOf(fx.dissociation.holds);
            const dropsMean = meanOf(fx.dissociation.drops);
            // The gap is the measurement: it is how much the judge separates the axes the
            // submission is strong on from the ones it is weak on. A gap near zero means
            // the per-axis breakdown carries no information the overall score lacks.
            const gap = holdsMean - dropsMean;
            const holdsInBand = fx.dissociation.holds.every((id) => {
              const b = fx.expected[id];
              const vs = runs.map((r) => r.axisScores[id]).filter((v) => typeof v === "number");
              return !b || (vs.length > 0 && deviation(mean(vs), b) === 0);
            });
            return {
              ...fx.dissociation,
              holdsMean,
              dropsMean,
              gap,
              holdsInBand,
              pass: holdsInBand && gap > 20,
            };
          })()
        : null,
      hardAssertions: (fx.hardAssertions ?? []).map((h) => {
        const vals = runs.map((r) => r.axisScores[h.axis]).filter((v) => typeof v === "number");
        const m = vals.length ? mean(vals) : NaN;
        return {
          ...h,
          observedMean: m,
          values: vals,
          pass: vals.length > 0 && deviation(m, h.band) === 0,
        };
      }),
    };
  });

  // --- per-axis aggregate across fixtures
  const perAxis = AXIS_IDS.map((axis) => {
    const rows = perFixture
      .map((f) => f.axes.find((a) => a.axis === axis)!)
      .filter((a) => a.band && Number.isFinite(a.mean));
    const devs = rows.map((r) => r.deviation!).filter((d) => Number.isFinite(d));
    // Signed distance from band MIDPOINT, not from the band edge. The edge distance is 0
    // for anything inside the band and so cannot show a consistent lean within the bands.
    const midDevs = rows.map((r) => r.mean - mid(r.band!));
    const sds = perFixture
      .map((f) => f.axes.find((a) => a.axis === axis)!.sd)
      .filter((v) => Number.isFinite(v));
    const inBand = rows.filter((r) => r.inBand).length;

    const allSameSign =
      midDevs.length >= MIN_FIXTURES_FOR_OFFSET &&
      (midDevs.every((d) => d > 0) || midDevs.every((d) => d < 0));

    const noiseFloor = sds.length ? mean(sds) : NaN;
    const lean = midDevs.length ? median(midDevs) : NaN;
    // Every guard must hold. The threshold is the LARGER of the measured noise and the
    // label-resolution floor, so a quiet-but-tiny lean is not promoted to a correction.
    const offsetWarranted =
      RUNS >= MIN_RUNS_FOR_OFFSET &&
      allSameSign &&
      Number.isFinite(lean) &&
      Math.abs(lean) > Math.max(noiseFloor || 0, MIN_MEANINGFUL_LEAN);

    return {
      axis,
      label: AXIS_LABEL[axis],
      assertedFixtures: rows.length,
      inBand,
      inBandPct: rows.length ? (100 * inBand) / rows.length : NaN,
      meanDeviationFromBand: devs.length ? mean(devs) : NaN,
      medianDeviationFromMidpoint: midDevs.length ? median(midDevs) : NaN,
      meanWithinFixtureSd: noiseFloor,
      maxWithinFixtureSd: sds.length ? Math.max(...sds) : NaN,
      consistentLean: allSameSign,
      noiseFloor,
      suggestedOffset: offsetWarranted ? -Math.round(lean) : 0,
    };
  });

  // --- global scale check on the consolidated StackScore
  const fitPoints = perFixture.filter((f) => f.stackScore.band && Number.isFinite(f.stackScore.mean));
  const fit = fitPoints.length >= 3
    ? linearFit(fitPoints.map((f) => mid(f.stackScore.band!)), fitPoints.map((f) => f.stackScore.mean))
    : null;

  const observedRange = fitPoints.length
    ? Math.max(...fitPoints.map((f) => f.stackScore.mean)) -
      Math.min(...fitPoints.map((f) => f.stackScore.mean))
    : NaN;
  const expectedRange = fitPoints.length
    ? Math.max(...fitPoints.map((f) => mid(f.stackScore.band!))) -
      Math.min(...fitPoints.map((f) => mid(f.stackScore.band!)))
    : NaN;

  return { perFixture, perAxis, fit, observedRange, expectedRange, failed, ok, fitPoints };
}

function fmt(n: number, d = 1): string {
  return Number.isFinite(n) ? n.toFixed(d) : "-";
}

function renderMarkdown(rep: ReturnType<typeof buildReport>): string {
  const L: string[] = [];
  const { perFixture, perAxis, fit } = rep;

  L.push("# Judge calibration report");
  L.push("");
  L.push(`- Generated: ${new Date().toISOString()}`);
  L.push(`- Model: \`${JUDGE_MODEL}\`, effort \`${JUDGE_EFFORT}\` (as configured in \`lib/judge.ts\`)`);
  L.push(`- Rubric/judge fingerprint: \`${fingerprintOf(rubric, JUDGE_MODEL, JUDGE_EFFORT)}\``);
  L.push(`- Fixtures: ${perFixture.length}; runs per fixture: ${RUNS}`);
  L.push(`- Judge calls: ${rep.ok.length} succeeded, ${rep.failed.length} failed`);
  L.push("");
  L.push(
    "Ground truth is the expected band recorded with each fixture in " +
      "`data/calibration/fixtures.ts`. Those bands are authored judgements, not panel " +
      "consensus — see the dataset README on what that does and does not license.",
  );
  L.push("");

  // 1. reliability first: it bounds everything else
  L.push("## 1. Reliability (run-to-run spread)");
  L.push("");
  L.push(
    "Spread comes first because it bounds accuracy: a score that moves more than the " +
      "bands are wide cannot be corrected by any offset, because there is no stable value " +
      "to correct.",
  );
  L.push("");
  L.push("| Fixture | StackScore runs | mean | sd | range |");
  L.push("|---|---|---|---|---|");
  for (const f of perFixture) {
    L.push(
      `| ${f.id} | ${f.stackScore.values.join(", ") || "-"} | ${fmt(f.stackScore.mean)} | ` +
        `${fmt(f.stackScore.sd)} | ${fmt(f.stackScore.range, 0)} |`,
    );
  }
  const allSd = perFixture.map((f) => f.stackScore.sd).filter(Number.isFinite);
  const allRange = perFixture.map((f) => f.stackScore.range).filter(Number.isFinite);
  L.push("");
  L.push(
    `Mean StackScore sd across fixtures: **${fmt(mean(allSd))}** points; ` +
      `worst observed range: **${fmt(Math.max(...allRange), 0)}** points.`,
  );
  L.push("");

  // 2. accuracy
  L.push("## 2. Accuracy (observed vs expected band)");
  L.push("");
  L.push("| Fixture | role | expected | observed mean | dev | verdict |");
  L.push("|---|---|---|---|---|---|");
  for (const f of perFixture) {
    const b = f.stackScore.band;
    L.push(
      `| ${f.id} ${f.label} | ${f.role} | ${b ? `${b[0]}-${b[1]}` : "-"} | ` +
        `${fmt(f.stackScore.mean)} | ${f.stackScore.deviation === null ? "-" : fmt(f.stackScore.deviation)} | ` +
        `${f.stackScore.inBand === null ? "-" : f.stackScore.inBand ? "in band" : "OUT"} |`,
    );
  }
  L.push("");

  // 3. per-axis
  L.push("## 3. Per-axis behaviour");
  L.push("");
  L.push(
    "`dev from mid` is the median signed distance from the band midpoint — the band-edge " +
      "distance is zero for anything inside the band and so cannot reveal a lean within the " +
      "bands. `noise` is the mean within-fixture sd for that axis.",
  );
  L.push("");
  L.push("| Axis | Label | asserted | in band | dev from mid | noise | offset |");
  L.push("|---|---|---|---|---|---|---|");
  for (const a of perAxis) {
    L.push(
      `| ${a.axis} | ${a.label} | ${a.assertedFixtures} | ${a.inBand}/${a.assertedFixtures} ` +
        `(${fmt(a.inBandPct, 0)}%) | ${fmt(a.medianDeviationFromMidpoint)} | ` +
        `${fmt(a.meanWithinFixtureSd)} | ${a.suggestedOffset === 0 ? "—" : (a.suggestedOffset > 0 ? "+" : "") + a.suggestedOffset} |`,
    );
  }
  L.push("");
  const offsets = perAxis.filter((a) => a.suggestedOffset !== 0);
  if (offsets.length === 0) {
    L.push(
      "**No per-axis offset is recommended.** Every axis either sits inside its band or " +
        "leans by less than its own run-to-run noise, in which case an offset would encode " +
        "sampling error rather than bias.",
    );
  } else {
    L.push("**Per-axis offsets recommended** (consistent in direction and larger than the noise floor):");
    L.push("");
    for (const a of offsets) {
      L.push(
        `- \`${a.axis}\` (${a.label}): **${a.suggestedOffset > 0 ? "+" : ""}${a.suggestedOffset}** ` +
          `— median lean ${fmt(a.medianDeviationFromMidpoint)} against a noise floor of ${fmt(a.noiseFloor)}.`,
      );
    }
  }
  L.push("");

  // 4. scale
  L.push("## 4. Scale check — is a rescale needed, or only a shift?");
  L.push("");
  if (!fit) {
    L.push("Too few fixtures with a StackScore band to fit a line (need 3).");
  } else {
    L.push(`- Fit of observed on expected: **observed = ${fmt(fit.slope, 3)} x expected + ${fmt(fit.intercept, 2)}**`);
    L.push(`- R² = ${fmt(fit.r2, 3)}`);
    L.push(`- Expected spread across fixtures: ${fmt(rep.expectedRange, 0)} points; observed: ${fmt(rep.observedRange, 0)} points.`);
    L.push("");
    L.push("Reading:");
    L.push("");
    L.push(
      "- **slope ≈ 1, intercept ≈ 0** — calibrated. No normalization; report raw scores.",
    );
    L.push(
      "- **slope ≈ 1, intercept ≠ 0** — a uniform shift. Subtract the intercept; rank order " +
        "is already right, only the absolute level is off.",
    );
    L.push(
      "- **slope < ~0.8** — scale compression: the judge avoids the extremes and crowds " +
        "everything toward the middle. This is the common LLM-judge failure and the one that " +
        "matters commercially, because it is what makes a strong and an average candidate " +
        "look similar. A per-axis offset cannot fix it — compression needs a linear rescale " +
        "`(raw - intercept) / slope`, clamped to 0-100.",
    );
    L.push(
      "- **low R² with a sane slope** — the judge is not ordering submissions consistently. " +
        "Do not normalize; a rescale of a weak ordering just redistributes the same error. " +
        "Fix the rubric's missing score anchors first.",
    );
    L.push("");
    // The actionable number is not the slope in the abstract: it is how wrong the score is
    // at the ends of the usable range, where hiring decisions are actually made. A slope of
    // 0.84 sounds mild and still costs ~9 points at the top of the scale.
    const at = (x: number) => fit.slope * x + fit.intercept;
    const errLow = at(15) - 15;
    const errHigh = at(85) - 85;
    L.push(
      `- Implied error at the ends of the usable range: **${fmt(errLow, 1)}** points at ` +
        `expected 15, **${fmt(errHigh, 1)}** points at expected 85.`,
    );
    L.push("");

    // Diagnosis order matters. Slope is tested on a tight band around 1 BEFORE the
    // intercept is read, because "subtract the intercept" is only sound advice when the
    // slope really is ~1. With slope < 1 a positive intercept is the *signature of
    // compression* (both ends pulled toward the middle), not a shift, and subtracting it
    // would push the top of the scale further from the truth while appearing to fix things.
    const SLOPE_OK: [number, number] = [0.92, 1.08];
    const isShiftLike = fit.slope >= SLOPE_OK[0] && fit.slope <= SLOPE_OK[1];

    const verdict =
      fit.r2 < 0.5
        ? "**Ordering is unreliable (R² < 0.5).** Normalization is not the right lever yet; " +
          "fix the rubric's missing score anchors first."
        : !isShiftLike && fit.slope < SLOPE_OK[0]
          ? `**Scale compression (slope ${fmt(fit.slope, 3)}, R² ${fmt(fit.r2, 3)}).** The ordering is ` +
            `sound but the range is squeezed: ${fmt(errHigh, 1)} points at the top and ` +
            `${fmt(errLow, 1)} at the bottom. Do NOT subtract the intercept — with slope < 1 a ` +
            `positive intercept is part of the compression, and subtracting it would push the ` +
            `top end further out. The matching correction is a rescale: ` +
            `\`normalized = clamp((raw - ${fmt(fit.intercept, 2)}) / ${fmt(fit.slope, 3)}, 0, 100)\`.`
          : !isShiftLike
            ? `**Scale expansion (slope ${fmt(fit.slope, 3)}).** The judge exaggerates differences. ` +
              `Same rescale form, which will compress rather than stretch.`
            : Math.abs(fit.intercept) > 5
              ? `**Uniform shift of ${fmt(fit.intercept, 1)} points** at slope ${fmt(fit.slope, 3)}. ` +
                `Subtracting the intercept is appropriate here because the slope is ~1, so the ` +
                `ordering and the spacing are both already right.`
              : "**No normalization required.** Slope and intercept are both within tolerance.";
    L.push(`Verdict: ${verdict}`);
    L.push("");
    L.push(
      "Before applying any correction, read §6 — a correction fitted to authored bands " +
        "encodes the band author's taste into every candidate's score.",
    );
  }
  L.push("");

  // 5. hard assertions
  L.push("## 5. Rule compliance (hard assertions)");
  L.push("");
  L.push(
    "These follow from explicit instructions in the judge's own system prompt, so a failure " +
      "is a bug rather than drift, and no offset addresses it.",
  );
  L.push("");
  L.push("| Fixture | Axis | Required | Observed | Pass |");
  L.push("|---|---|---|---|---|");
  for (const f of perFixture) {
    for (const h of f.hardAssertions) {
      L.push(
        `| ${f.id} | ${h.axis} | ${h.band[0]}-${h.band[1]} | ${fmt(h.observedMean)} ` +
          `(${h.values.join(", ")}) | ${h.pass ? "yes" : "**NO**"} |`,
      );
    }
  }
  L.push("");
  for (const f of perFixture) {
    for (const h of f.hardAssertions.filter((x) => !x.pass)) {
      L.push(`- **${f.id}/${h.axis} failed.** ${h.why}`);
    }
  }
  L.push("");

  // 6. axis independence
  const diss = perFixture.filter((f) => f.dissociation);
  if (diss.length) {
    L.push("## 6. Axis independence (halo check)");
    L.push("");
    L.push(
      "The judge is instructed: \"Score each axis solely on its own criteria. Do not let one " +
        "axis's impression affect another's score.\" These fixtures are strong on one axis and " +
        "weak on another by construction, so the gap below is a direct measure of whether the " +
        "eleven axes carry eleven axes' worth of information — which is the entire reason a " +
        "hiring team wants a breakdown rather than one number.",
    );
    L.push("");
    L.push("| Fixture | should hold | mean | should drop | mean | gap | verdict |");
    L.push("|---|---|---|---|---|---|---|");
    for (const f of diss) {
      const d = f.dissociation!;
      L.push(
        `| ${f.id} | ${d.holds.join(", ")} | ${fmt(d.holdsMean)} | ${d.drops.join(", ")} | ` +
          `${fmt(d.dropsMean)} | ${fmt(d.gap)} | ${d.pass ? "separated" : "**CONTAMINATED**"} |`,
      );
    }
    L.push("");
    for (const f of diss.filter((x) => !x.dissociation!.pass)) {
      const d = f.dissociation!;
      L.push(
        `- **${f.id}: ${d.holds.join(", ")} did not hold** (${fmt(d.holdsMean)}, ` +
          `gap to ${d.drops.join("/")} only ${fmt(d.gap)}). ${d.why}`,
      );
    }
    L.push("");
  }

  // 7. the honest caveats, because every number above is easy to over-read
  L.push("## 7. Limits of this evidence");
  L.push("");
  L.push(
    "Read before acting on anything above. The numbers are real measurements; what they " +
      "license is narrower than it looks.",
  );
  L.push("");
  L.push(
    `- **The bands are authored, not panel consensus.** Where the judge sits outside a band, ` +
      `the band may be wrong rather than the judge. This is the single biggest limitation, ` +
      `and it bears directly on the per-axis offsets: an offset fitted to one person's ` +
      `estimates ships that person's taste as if it were measurement.`,
  );
  const thin = perAxis.filter((a) => a.assertedFixtures > 0 && a.assertedFixtures < 6);
  if (thin.length) {
    L.push(
      `- **Thin coverage on ${thin.map((a) => a.axis).join(", ")}** ` +
        `(${thin.map((a) => `${a.axis}: n=${a.assertedFixtures}`).join(", ")}). ` +
        `A "consistent" lean over 4-5 fixtures is weak evidence; treat any offset on these ` +
        `axes as a hypothesis to test, not a correction to apply.`,
    );
  }
  L.push(
    `- **Axes whose fixtures carry little signal read low for a legitimate reason.** If most ` +
      `fixtures ship no tests, a low K5 is the correct score, not a bias — and an offset ` +
      `would then reward submissions that genuinely have no tests. Check what the fixtures ` +
      `actually contain for an axis before correcting it.`,
  );
  L.push(
    `- **n=${RUNS} runs per fixture.** Enough to show the spread is small; not enough to ` +
      `characterise a tail. A rare pathological run would not appear here.`,
  );
  L.push(
    "- **One brief.** Deliberate, so that submission quality is the only variable, but it " +
      "means these results do not demonstrate stability across problem domains.",
  );
  L.push("");

  if (rep.failed.length) {
    L.push("## 8. Failed judge calls");
    L.push("");
    for (const f of rep.failed) L.push(`- ${f.fixtureId} run ${f.run}: ${f.error}`);
    L.push("");
  }

  return L.join("\n");
}

// ---------------------------------------------------------------------------- the test

test.describe("judge calibration", () => {
  test.skip(
    process.env.RUN_CALIBRATION !== "1",
    "Calls the real Anthropic API and costs money. Set RUN_CALIBRATION=1 to run.",
  );

  test("scores fixtures within their expected bands", async () => {
    const fixtures = ONLY ? FIXTURES.filter((f) => ONLY.includes(f.id)) : FIXTURES;
    expect(fixtures.length, "no fixtures selected").toBeGreaterThan(0);

    // Judge calls are minutes-long at effort high; this sweep is tens of them.
    test.setTimeout(90 * 60_000);

    // Replay mode: re-derive the whole report from a previous sweep's raw scores, with no
    // API calls and no cost. The analysis (offset gating, the scale fit, the verdict) is
    // the part most likely to need correcting, and re-billing 30 judge calls to fix a line
    // of arithmetic would be wasteful enough to discourage fixing it.
    //
    //   CALIBRATION_REPLAY=test-results/calibration-report.json \
    //     RUN_CALIBRATION=1 npx playwright test --project=calibration
    let results: RunResult[];
    if (process.env.CALIBRATION_REPLAY) {
      const saved = JSON.parse(fs.readFileSync(process.env.CALIBRATION_REPLAY, "utf8"));
      expect(
        Array.isArray(saved.results),
        "replay file has no raw `results` array (it predates replay support)",
      ).toBe(true);
      results = saved.results as RunResult[];
      // eslint-disable-next-line no-console
      console.log(`calibration: REPLAY of ${results.length} saved judge calls (no API calls)`);
    } else {
      const jobs = fixtures.flatMap((fx) =>
        Array.from({ length: RUNS }, (_, i) => ({ fx, run: i + 1 })),
      );
      // eslint-disable-next-line no-console
      console.log(`calibration: ${fixtures.length} fixtures x ${RUNS} runs = ${jobs.length} judge calls`);
      results = await mapLimit(jobs, CONCURRENCY, (j) => runFixture(j.fx, j.run));
    }
    const rep = buildReport(fixtures, results);

    // Write the report BEFORE asserting, so a failing calibration still produces the
    // artifact that explains why it failed. An assertion that destroys its own evidence
    // is useless in exactly the case you need it.
    const outDir = path.join(__dirname, "..", "test-results");
    fs.mkdirSync(outDir, { recursive: true });
    const md = renderMarkdown(rep);
    fs.writeFileSync(path.join(outDir, "calibration-report.md"), md);
    fs.writeFileSync(
      path.join(outDir, "calibration-report.json"),
      // `results` first-class in the artifact: it is the only irreproducible part (it cost
      // money and cannot be recomputed), and it is what CALIBRATION_REPLAY reads back.
      JSON.stringify(
        {
          runs: RUNS,
          generatedAt: new Date().toISOString(),
          // Stamped so the calibration monitor can tell whether the COMMITTED evidence
          // describes the judge that is actually deployed. Without it the monitor can only
          // compare against its own previous probe, and reports "results are stale" after
          // every rubric edit even when a sweep has since been run.
          fingerprint: fingerprintOf(rubric, JUDGE_MODEL, JUDGE_EFFORT),
          results,
          ...rep,
        },
        null,
        2,
      ),
    );
    // eslint-disable-next-line no-console
    console.log("\n" + md);

    // --- assertions, weakest claim first

    expect(rep.failed, `judge calls failed: ${rep.failed.map((f) => f.error).join("; ")}`)
      .toHaveLength(0);

    // Rule compliance is non-negotiable: these are the judge's own documented rules.
    const ruleFailures = rep.perFixture.flatMap((f) =>
      f.hardAssertions.filter((h) => !h.pass).map((h) => `${f.id}/${h.axis}=${fmt(h.observedMean)} (need ${h.band[0]}-${h.band[1]}): ${h.why}`),
    );
    expect(ruleFailures, "judge violated its own documented scoring rules").toEqual([]);

    // Ordering is the product's real claim: a hiring team needs ranking, not absolute truth.
    // Checked before band compliance because a correct ordering with a shifted level is
    // fixable by normalization, while a broken ordering is not.
    if (rep.fit) {
      expect(
        rep.fit.r2,
        `judge does not order submissions consistently (R²=${fmt(rep.fit.r2, 3)}); ` +
          "normalization cannot repair this - add score anchors to data/rubric.json",
      ).toBeGreaterThan(0.5);
    }

    // Band compliance last: the most opinionated assertion, since it rests on authored
    // ground truth. Reported as a rate rather than per-fixture so one debatable label
    // cannot fail the gate on its own.
    const asserted = rep.perFixture.filter((f) => f.stackScore.band);
    const inBand = asserted.filter((f) => f.stackScore.inBand).length;
    expect(
      inBand / asserted.length,
      `only ${inBand}/${asserted.length} fixtures landed in their expected StackScore band; ` +
        "see test-results/calibration-report.md",
    ).toBeGreaterThanOrEqual(0.7);
  });
});
