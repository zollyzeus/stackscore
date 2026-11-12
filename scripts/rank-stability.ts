/**
 * Band-free measures from a committed calibration sweep.
 *
 *   npx tsx scripts/rank-stability.ts [path-to-runs.json]
 *
 * Everything in the calibration README that speaks to ACCURACY is measured against bands
 * one person authored, and is therefore only as good as those bands. These two measures are
 * not: they use nothing but the judge's own scores across independent runs. No ground truth,
 * no panel, nothing to dispute.
 *
 *   1. Rank stability — does the judge order the same ten submissions the same way on
 *      independent runs? For a hiring product this is the deliverable. A team does not act
 *      on "this candidate scored 68"; it acts on "this candidate is stronger than that one".
 *
 *   2. Separation — how many run-to-run standard deviations apart are adjacent submissions?
 *      Consistency alone is worthless if everything lands in a narrow band: a judge that
 *      reliably scores every candidate 50 is perfectly reliable and perfectly useless. This
 *      says whether the gaps the judge reports are larger than its own noise.
 *
 * Neither says the scores are RIGHT. A judge can rank consistently and separate cleanly
 * while being uniformly too harsh. That is what the panel (see PANEL.md) is for.
 */
import { readFileSync } from "fs";

const path = process.argv[2] ?? "data/calibration/post-anchor-runs.json";
const doc = JSON.parse(readFileSync(path, "utf8")) as {
  results: Array<{ fixtureId: string; run?: number; stackScore: number }>;
};

const byFixture = new Map<string, number[]>();
for (const r of doc.results) {
  if (!byFixture.has(r.fixtureId)) byFixture.set(r.fixtureId, []);
  byFixture.get(r.fixtureId)!.push(r.stackScore);
}
const fixtures = [...byFixture.keys()].sort();
const nRuns = byFixture.get(fixtures[0])!.length;
const scores = (f: string, i: number) => byFixture.get(f)![i];

console.log(`fixtures: ${fixtures.length}   runs each: ${nRuns}\n`);

// ── 1. Rank stability ────────────────────────────────────────────────────────
console.log("=== 1. RANK STABILITY (no ground truth needed) ===\n");
const orders = Array.from({ length: nRuns }, (_, i) =>
  [...fixtures].sort((a, b) => scores(b, i) - scores(a, i))
);
orders.forEach((o, i) => console.log(`  run ${i + 1}: ${o.join(" > ")}`));

function spearman(a: string[], b: string[]): number {
  const ra = new Map(a.map((f, i) => [f, i]));
  const rb = new Map(b.map((f, i) => [f, i]));
  const n = a.length;
  const dsq = a.reduce((s, f) => s + (ra.get(f)! - rb.get(f)!) ** 2, 0);
  return 1 - (6 * dsq) / (n * (n * n - 1));
}

console.log();
const rhos: number[] = [];
for (let i = 0; i < nRuns; i++) {
  for (let j = i + 1; j < nRuns; j++) {
    const rho = spearman(orders[i], orders[j]);
    rhos.push(rho);
    // Pairwise inversions are the plain-language version of rho: how many of the 45
    // "is A better than B?" questions are answered differently between two runs.
    let inversions = 0, pairs = 0;
    for (let x = 0; x < fixtures.length; x++) {
      for (let y = x + 1; y < fixtures.length; y++) {
        pairs++;
        const a = fixtures[x], b = fixtures[y];
        if ((scores(a, i) - scores(b, i)) * (scores(a, j) - scores(b, j)) < 0) inversions++;
      }
    }
    console.log(`  run ${i + 1} vs run ${j + 1}:  Spearman rho = ${rho.toFixed(3)}   pairwise inversions = ${inversions}/${pairs}`);
  }
}
console.log(`\n  mean Spearman rho across run pairs: ${(rhos.reduce((a, b) => a + b, 0) / rhos.length).toFixed(3)}`);

// ── 2. Separation ────────────────────────────────────────────────────────────
console.log("\n=== 2. SEPARATION (no ground truth needed) ===\n");
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const sd = (v: number[]) => {
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
};
const means = new Map(fixtures.map((f) => [f, mean(byFixture.get(f)!)]));
const pooled = Math.sqrt(mean(fixtures.map((f) => sd(byFixture.get(f)!) ** 2)));
console.log(`  pooled run-to-run sd: ${pooled.toFixed(2)} points\n`);

const ordered = [...fixtures].sort((a, b) => means.get(b)! - means.get(a)!);
const gaps: number[] = [];
console.log("  adjacent pairs, best to worst:");
for (let i = 0; i < ordered.length - 1; i++) {
  const a = ordered[i], b = ordered[i + 1];
  const gap = means.get(a)! - means.get(b)!;
  gaps.push(gap / pooled);
  console.log(
    `    ${a} (${means.get(a)!.toFixed(1).padStart(5)}) vs ${b} (${means.get(b)!.toFixed(1).padStart(5)})` +
    `   gap ${gap.toFixed(1).padStart(5)} = ${(gap / pooled).toFixed(1).padStart(5)} sd`
  );
}
console.log(`\n  smallest adjacent gap: ${Math.min(...gaps).toFixed(1)} sd`);
console.log(`\nNeither measure says the scores are RIGHT — a judge can rank consistently and`);
console.log(`separate cleanly while being uniformly too harsh. See PANEL.md.`);
