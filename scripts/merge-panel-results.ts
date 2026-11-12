/**
 * Merges panel grader results into inter-grader agreement and proposed bands.
 *
 *   npx tsx scripts/merge-panel-results.ts ./panel-pack/pack-key.json ./results/*.json
 *
 * Reports, in this order and deliberately so:
 *
 *   1. INTER-GRADER AGREEMENT, before anything about the judge is mentioned.
 *      This is the result most likely to be skipped and the one that carries the most.
 *      If two humans disagree on an axis by more than the judge's run-to-run spread
 *      (0.8-1.2 points), the judge is already more consistent than the graders on it, and
 *      the honest product move is to report a band rather than a point. Looking at the
 *      judge first makes it very hard to read that number neutrally afterwards.
 *
 *   2. PROPOSED BANDS, [min, max] across graders, to paste into fixtures.ts.
 *
 *   3. WHERE THE PANEL DISAGREES WITH THE AUTHORED BANDS, which says whether my labels
 *      were generous, harsh, or fine -- the open question behind every "K2/K4/K5 are graded
 *      too hard" claim in the calibration README.
 */
import { readFileSync } from "fs";
import { FIXTURES } from "../data/calibration/fixtures";
import rubric from "../data/rubric.json";

const AXES = rubric.levels.flatMap((l) => l.axes.map((a) => a.id));
/** Mean StackScore sd of the judge across runs, from data/calibration/post-anchor-report.md. */
const JUDGE_SD = 1.2;

const [keyPath, ...resultPaths] = process.argv.slice(2);
if (!keyPath || resultPaths.length === 0) {
  console.error("usage: merge-panel-results.ts <pack-key.json> <grader-N.json>...");
  process.exit(1);
}

type Cell = { score?: number | null; cannotAssess?: boolean; note?: string };
const keys = JSON.parse(readFileSync(keyPath, "utf8")) as Record<string, Record<string, string>>;

/** fixtureId -> axis -> grader -> score (null = cannot assess) */
const grid: Record<string, Record<string, Record<string, number | null>>> = {};
const graderIds: string[] = [];

for (const p of resultPaths) {
  const doc = JSON.parse(readFileSync(p, "utf8")) as { grader: number; scores: Record<string, Cell> };
  const gid = `grader-${doc.grader}`;
  const map = keys[gid];
  if (!map) { console.error(`no key entry for ${gid} (from ${p})`); process.exit(1); }
  graderIds.push(gid);

  for (const [cellKey, cell] of Object.entries(doc.scores)) {
    const [letter, axis] = cellKey.split(".");
    const fixtureId = map[letter];
    if (!fixtureId || !AXES.includes(axis)) continue;
    grid[fixtureId] ??= {};
    grid[fixtureId][axis] ??= {};
    grid[fixtureId][axis][gid] = cell.cannotAssess ? null : (cell.score ?? null);
  }
}

if (graderIds.length < 2) {
  console.error("\nNeed at least two graders. One grader's numbers are not consensus -- they are\n" +
                "the same problem this exercise exists to fix, with a different author.");
  process.exit(1);
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

// ── 1. Inter-grader agreement ────────────────────────────────────────────────
console.log(`\n=== 1. INTER-GRADER AGREEMENT (${graderIds.length} graders) ===\n`);
console.log("Read this before anything about the judge.\n");
console.log("axis  n   mean spread   max spread   vs judge   verdict");

const axisVerdict: Record<string, string> = {};
for (const axis of AXES) {
  const spreads: number[] = [];
  for (const f of FIXTURES) {
    const row = grid[f.id]?.[axis];
    if (!row) continue;
    const vals = Object.values(row).filter((v): v is number => typeof v === "number");
    if (vals.length < 2) continue;
    spreads.push(Math.max(...vals) - Math.min(...vals));
  }
  if (spreads.length === 0) { axisVerdict[axis] = "no data"; continue; }
  const m = mean(spreads), mx = Math.max(...spreads);
  // Thresholds are absolute points on the 0-100 scale, not multiples of the judge's sd.
  // Keying them to the judge (1.2) made every row read "far more than the judge varies",
  // which is true and useless: humans essentially always disagree more than an LLM varies
  // on reruns. The question worth answering is how much, in units a hiring team cares
  // about -- a 5-point spread is noise around a shared view, a 20-point spread means the
  // graders are not measuring the same thing.
  const verdict = m > 15
    ? "WIDE — publish a range on this axis, not a point"
    : m > 8
      ? "moderate — a point estimate is shaky"
      : m > 4
        ? "workable — usable band, some drift"
        : "tight — the graders agree";
  axisVerdict[axis] = verdict;
  console.log(
    `${axis.padEnd(5)} ${String(spreads.length).padStart(2)}  ${fmt(m).padStart(10)}   ` +
    `${String(mx).padStart(10)}   ${(fmt(m / JUDGE_SD) + "x").padStart(8)}   ${verdict}`
  );
}

console.log(`\nJudge run-to-run sd for comparison: ${JUDGE_SD} points; the "vs judge" column`);
console.log("is each axis's human spread as a multiple of it. Expect every axis to exceed 1x --");
console.log("humans disagree more than an LLM varies on reruns, which is normal and not a");
console.log("defect. What matters is the absolute spread: an axis where two qualified graders");
console.log("land 20 points apart is an axis where the product should publish a range rather");
console.log("than a number, and saying so is a stronger claim than a false precision.");

// ── 2. Proposed bands ────────────────────────────────────────────────────────
console.log(`\n=== 2. PROPOSED BANDS (paste into data/calibration/fixtures.ts) ===\n`);
for (const f of FIXTURES) {
  const lines: string[] = [];
  for (const axis of AXES) {
    const row = grid[f.id]?.[axis];
    if (!row) continue;
    const vals = Object.values(row).filter((v): v is number => typeof v === "number");
    const nas = Object.values(row).filter((v) => v === null).length;
    // Unanimous "cannot assess" means the fixture genuinely carries no signal for that
    // axis. That is an absent band, NOT a band of [0, 0]: scoring it zero would punish a
    // candidate for something the fixture never asked them to demonstrate.
    if (vals.length === 0) { lines.push(`      // ${axis}: all graders could not assess — no band`); continue; }
    if (vals.length < Object.keys(row).length) {
      lines.push(`      ${axis}: [${Math.min(...vals)}, ${Math.max(...vals)}], // ${nas} grader(s) could not assess`);
    } else {
      lines.push(`      ${axis}: [${Math.min(...vals)}, ${Math.max(...vals)}],`);
    }
  }
  console.log(`    // ${f.id} — ${f.label}\n    expected: {\n${lines.join("\n")}\n    },\n`);
}

// ── 3. Panel vs the authored bands ───────────────────────────────────────────
console.log(`=== 3. PANEL vs THE AUTHORED BANDS ===\n`);
console.log("Positive = the panel scored HIGHER than the authored midpoint, i.e. the original");
console.log("bands were harsh. Negative = the authored bands were generous.\n");
console.log("axis   n   median shift   reading");

for (const axis of AXES) {
  const shifts: number[] = [];
  for (const f of FIXTURES) {
    const authored = (f.expected as Record<string, [number, number]>)?.[axis];
    const row = grid[f.id]?.[axis];
    if (!authored || !row) continue;
    const vals = Object.values(row).filter((v): v is number => typeof v === "number");
    if (vals.length === 0) continue;
    shifts.push(mean(vals) - (authored[0] + authored[1]) / 2);
  }
  if (shifts.length === 0) continue;
  shifts.sort((a, b) => a - b);
  const med = shifts[Math.floor(shifts.length / 2)];
  const reading = Math.abs(med) < 5 ? "authored band was about right"
    : med > 0 ? "authored band was HARSH — the judge may have been right"
              : "authored band was GENEROUS — the judge's strictness was justified";
  console.log(`${axis.padEnd(5)} ${String(shifts.length).padStart(2)}  ${fmt(med).padStart(12)}   ${reading}`);
}

console.log(`\nNext: paste section 2 into fixtures.ts (keep the originals as \`expectedAuthored\`),`);
console.log(`then re-run the sweep. Only then is a normalization offset fitted to consensus`);
console.log(`rather than to one person.`);
