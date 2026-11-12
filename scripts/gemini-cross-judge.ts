/**
 * Gemini cross-judge triage for contested K-axis cells.
 *
 * Runs the 5 most contested fixtures (F01, F02, F05, F09, F10) through Gemini,
 * scoring only K2, K4, K5, and reports whether Gemini agrees with our Claude judge
 * or with the authored bands. This is triage, not ground truth:
 *   - Gemini agreeing with Claude → authored band is probably harsh
 *   - Gemini agreeing with the band → Claude judge is probably too strict
 *   - Gemini in between → genuinely contested; note it in the submission
 *
 * Usage:
 *   GEMINI_API_KEY=... npx tsx scripts/gemini-cross-judge.ts
 *   or with .env.local:
 *   npx dotenv -e .env.local -- tsx scripts/gemini-cross-judge.ts
 *
 * Cost: ~5 fixtures × ~3000 tokens input × $0.075/MTok ≈ $0.001 (Gemini 3.8 Flash is cheap)
 */

import { readFileSync, writeFileSync } from "fs";
import { FIXTURES } from "../data/calibration/fixtures";

const MODEL = "gemini-3.8-flash";
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("GEMINI_API_KEY not set. Run: npx dotenv -e .env.local -- tsx scripts/gemini-cross-judge.ts");
  process.exit(1);
}

// Contested fixtures and axes to triage
const TRIAGE_TARGETS: Record<string, string[]> = {
  F01: ["K2", "K4", "K5"],
  F02: ["K2"],
  F05: ["K2", "K5"],
  F09: ["K2"],
  F10: ["K2"],
};

// Rubric axis definitions (K2, K4, K5)
const AXIS_DEFS = {
  K2: {
    label: "Correctness & Edge Cases",
    description: "Does it work, including boundary/failure conditions.",
    anchors: {
      "0-24": "Does not work on the main path; logic errors defeat the stated purpose.",
      "25-49": "The happy path works, but a boundary the brief named is mishandled — off-by-one at the limit, undefined behaviour at the threshold, an obvious race in the stated topology.",
      "50-74": "Main path correct and the obvious boundaries handled: limit edges, empty or missing input, the concurrency condition the brief states. Working code with no identified correctness defect belongs here rather than in 25-49 — do not demand exhaustiveness for this band. This requires code (or pseudo-code) substantial enough to judge; where there is little or none, score the evident intent and do not default here.",
      "75-100": "Correct including the non-obvious cases — clock skew, concurrent update, partial failure, resource exhaustion — and the candidate shows why it is correct, not just that it runs.",
    },
  },
  K4: {
    label: "Security & Defensive Coding",
    description: "Input validation, secrets handling, authz checks.",
    anchors: {
      "0-24": "Actively unsafe: untrusted input reaches a dangerous position unvalidated, secrets hardcoded, authz absent where the brief requires it.",
      "25-49": "Not dangerous but defenseless: input trusted, errors leak internals, no thought given to abuse of the interface being built.",
      "50-74": "Validates external input, keeps secrets out of code, and handles the obvious abuse of this specific feature. Reaching it requires positive evidence of defensive thinking somewhere in the submission; silence on the subject is not the same as handling it.",
      "75-100": "Treats the trust boundary deliberately — validation with explicit failure behaviour, least privilege, and awareness of the abuse cases particular to this brief.",
    },
  },
  K5: {
    label: "Testing & Observability",
    description: "Tests written, error handling, logging/instrumentation present.",
    anchors: {
      "0-24": "No tests, no error handling, and no way to tell what the system is doing at runtime.",
      "25-49": "Error handling is present but ad hoc. No tests, or tests that assert nothing meaningful.",
      "50-74": "Tests cover the main behaviour and at least one failure case, and failures surface somewhere a human would see them. It does require tests or error handling to actually exist — a submission with neither scores below, however good its design.",
      "75-100": "Tests target the risky cases rather than the convenient ones, and the system is observable in the terms this brief cares about.",
    },
  },
};

function buildPrompt(fixture: (typeof FIXTURES)[0], axes: string[]): string {
  const axisDefs = axes
    .map((id) => {
      const def = AXIS_DEFS[id as keyof typeof AXIS_DEFS];
      const bands = Object.entries(def.anchors)
        .map(([b, t]) => `    ${b}: ${t}`)
        .join("\n");
      return `## ${id}: ${def.label}\n${def.description}\n\nBands:\n${bands}`;
    })
    .join("\n\n");

  return `You are scoring a software engineering assessment submission.

Score the following axes ONLY: ${axes.join(", ")}
Return a JSON object with exactly these keys: ${axes.map((a) => `"${a}"`).join(", ")}
Each value is an integer 0-100.
Do not explain. Output only valid JSON.

## Rubric

${axisDefs}

---

## Brief (the problem statement)

${fixture.submission.brief}

---

## Candidate submission

### Stage 1 — Clarifying questions
${fixture.submission.clarifyingTranscript}

### Stage 2 — Design proposal
${fixture.submission.designProposal}

### Stage 3 — Code
${fixture.submission.code || "(no code submitted)"}

### Stage 4 — Twist adaptation
${fixture.submission.twistResponse}

### Stage 5 — Debug
${fixture.submission.debugResponse}

---

Respond with JSON only:`;
}

async function geminiScore(
  fixtureId: string,
  fixture: (typeof FIXTURES)[0],
  axes: string[]
): Promise<Record<string, number>> {
  const prompt = buildPrompt(fixture, axes);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    // Try to extract JSON from markdown code blocks
    const m = text.match(/```(?:json)?\s*([\s\S]+?)```/);
    if (m) return JSON.parse(m[1]);
    throw new Error(`Could not parse Gemini response: ${text.slice(0, 200)}`);
  }
}

// Load sweep results for comparison
const sweep = JSON.parse(readFileSync("data/calibration/post-anchor-runs.json", "utf8")) as {
  results: Array<{ fixtureId: string; axisScores: Record<string, number>; stackScore: number }>;
};
const claudeByFixture = new Map<string, Record<string, number[]>>();
for (const r of sweep.results) {
  if (!claudeByFixture.has(r.fixtureId)) claudeByFixture.set(r.fixtureId, {});
  const m = claudeByFixture.get(r.fixtureId)!;
  for (const [axis, score] of Object.entries(r.axisScores)) {
    if (!m[axis]) m[axis] = [];
    m[axis].push(score);
  }
}
function claudeMean(fixtureId: string, axis: string): number {
  const vals = claudeByFixture.get(fixtureId)?.[axis] ?? [];
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
}

// Authored bands from analysis
const AUTHORED_BANDS: Record<string, Record<string, [number, number]>> = {
  F01: { K2: [70, 92], K4: [55, 85], K5: [40, 70] },
  F02: { K2: [55, 82] },
  F05: { K2: [70, 95], K5: [70, 95] },
  F09: { K2: [60, 90] },
  F10: { K2: [68, 92] },
};

async function main() {
  console.log(`\nGemini cross-judge triage  (model: ${MODEL})`);
  console.log(`Fixtures: ${Object.keys(TRIAGE_TARGETS).join(", ")}`);
  console.log(`Axes: K2, K4, K5 (the ones most below authored bands)\n`);
  console.log("─".repeat(80));

  const results: Array<{
    fixture: string;
    axis: string;
    authoredBand: [number, number];
    claudeMean: number;
    geminiScore: number;
    verdict: string;
  }> = [];

  for (const [fixtureId, axes] of Object.entries(TRIAGE_TARGETS)) {
    const fixture = FIXTURES.find((f) => f.id === fixtureId);
    if (!fixture) {
      console.error(`Fixture ${fixtureId} not found`);
      continue;
    }

    process.stdout.write(`Scoring ${fixtureId} (${fixture.role})… `);
    let geminiScores: Record<string, number>;
    try {
      geminiScores = await geminiScore(fixtureId, fixture, axes);
      console.log(`done  (${Object.entries(geminiScores).map(([k, v]) => `${k}=${v}`).join(", ")})`);
    } catch (e) {
      console.error(`FAILED: ${e}`);
      continue;
    }

    for (const axis of axes) {
      const claude = claudeMean(fixtureId, axis);
      const gemini = geminiScores[axis];
      const band = AUTHORED_BANDS[fixtureId]?.[axis];
      if (!band || gemini === undefined) continue;
      const bandMid = (band[0] + band[1]) / 2;

      // Verdict: who is Gemini closer to?
      const dClaude = Math.abs(gemini - claude);
      const dBand = Math.abs(gemini - bandMid);
      let verdict: string;
      if (dClaude <= 8 && dBand > 12) {
        verdict = "VALIDATES CLAUDE";
      } else if (dBand <= 8 && dClaude > 12) {
        verdict = "VALIDATES BAND";
      } else if (gemini >= band[0] && gemini <= band[1]) {
        verdict = "in band (mild)";
      } else {
        verdict = `contested (G=${gemini} C=${claude.toFixed(0)} B=${band[0]}-${band[1]})`;
      }

      results.push({ fixture: fixtureId, axis, authoredBand: band, claudeMean: claude, geminiScore: gemini, verdict });
    }

    // Small delay to avoid rate limits
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log("\n" + "─".repeat(80));
  console.log("\n=== TRIAGE RESULTS ===\n");
  const h = (s: string, w: number, right = false) => right ? s.padStart(w) : s.padEnd(w);
  console.log(`${h("Fix",5)} ${h("Axis",5)} ${h("Band",10,true)} ${h("Claude",8,true)} ${h("Gemini",8,true)} Verdict`);
  console.log("-".repeat(65));
  for (const r of results) {
    const band = `${r.authoredBand[0]}-${r.authoredBand[1]}`;
    console.log(
      `${h(r.fixture,5)} ${h(r.axis,5)} ${h(band,10,true)} ${h(r.claudeMean.toFixed(1),8,true)} ${h(String(r.geminiScore),8,true)}  ${r.verdict}`
    );
  }

  // Summary
  const validatedClaude = results.filter((r) => r.verdict === "VALIDATES CLAUDE").length;
  const validatedBand = results.filter((r) => r.verdict === "VALIDATES BAND").length;
  const total = results.length;
  console.log(`\n${"─".repeat(65)}`);
  console.log(`Total cells: ${total}`);
  console.log(`Gemini agrees with Claude: ${validatedClaude} (authored band probably harsh)`);
  console.log(`Gemini agrees with band:   ${validatedBand} (Claude judge probably too strict)`);
  console.log(`Contested/mild:            ${total - validatedClaude - validatedBand}`);

  console.log(`\n=== INTERPRETATION ===\n`);
  if (validatedClaude > validatedBand) {
    console.log(
      `Gemini leans toward Claude on ${validatedClaude}/${total} cells — ` +
      `suggests the authored bands are generous rather than the judge being strict.\n` +
      `Claim: "A second major-model judge agrees with our scoring on the contested axes."`
    );
  } else if (validatedBand > validatedClaude) {
    console.log(
      `Gemini leans toward the authored bands on ${validatedBand}/${total} cells — ` +
      `suggests the Claude judge is genuinely strict on these axes.\n` +
      `Action: Note the strictness in the rubric anchors; consider softening K2/K5 bands.`
    );
  } else {
    console.log(`Mixed result — axes are genuinely contested. See per-cell table above.`);
  }

  // Save results
  const outPath = "data/calibration/gemini-triage.json";
  writeFileSync(outPath, JSON.stringify({ model: MODEL, date: new Date().toISOString(), results }, null, 2));
  console.log(`\nResults saved to ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
