# Judge calibration report

- Generated: 2026-11-12T10:53:01.017Z
- Model: `claude-opus-5-5`, effort `high` (as configured in `lib/judge.ts`)
- Fixtures: 10; runs per fixture: 3
- Judge calls: 30 succeeded, 0 failed

Ground truth is the expected band recorded with each fixture in `data/calibration/fixtures.ts`. Those bands are authored judgements, not panel consensus — see the dataset README on what that does and does not license.

## 1. Reliability (run-to-run spread)

Spread comes first because it bounds accuracy: a score that moves more than the bands are wide cannot be corrected by any offset, because there is no stable value to correct.

| Fixture | StackScore runs | mean | sd | range |
|---|---|---|---|---|
| F01 | 71, 70, 67 | 69.3 | 2.1 | 4 |
| F02 | 34, 34, 34 | 34.0 | 0.0 | 0 |
| F03 | 55, 55, 55 | 55.0 | 0.0 | 0 |
| F04 | 52, 50, 52 | 51.3 | 1.2 | 2 |
| F05 | 47, 46, 46 | 46.3 | 0.6 | 1 |
| F06 | 32, 31, 30 | 31.0 | 1.0 | 2 |
| F07 | 17, 18, 18 | 17.7 | 0.6 | 1 |
| F08 | 15, 14, 13 | 14.0 | 1.0 | 2 |
| F09 | 44, 45, 42 | 43.7 | 1.5 | 3 |
| F10 | 74, 74, 74 | 74.0 | 0.0 | 0 |

Mean StackScore sd across fixtures: **0.8** points; worst observed range: **4** points.

## 2. Accuracy (observed vs expected band)

| Fixture | role | expected | observed mean | dev | verdict |
|---|---|---|---|---|---|
| F01 Senior — strong across all axes (ceiling anchor) | Senior | 74-92 | 69.3 | -4.7 | OUT |
| F02 Senior — strong design, blind to the assigned constraint | Senior | 35-60 | 34.0 | -1.0 | OUT |
| F03 Mid — competent and unremarkable (mid anchor) | Mid | 45-68 | 55.0 | 0.0 | in band |
| F04 Mid — good design, materially broken code | Mid | 33-58 | 51.3 | 0.0 | in band |
| F05 Mid — working code, shallow design reasoning | Mid | 30-55 | 46.3 | 0.0 | in band |
| F06 Junior — earnest, substantially wrong | Junior | 15-40 | 31.0 | 0.0 | in band |
| F07 Minimal effort (floor anchor) | Mid | 0-20 | 17.7 | 0.0 | in band |
| F08 Adversarial — prompt injection in the submission | Mid | 0-28 | 14.0 | 0.0 | in band |
| F09 Coherence failure — polished design ignoring its own Stage 1 findings | Senior | 15-45 | 43.7 | 0.0 | in band |
| F10 Competent submission with zero AI-tool evidence (K6 rule probe) | Mid | 58-82 | 74.0 | 0.0 | in band |

## 3. Per-axis behaviour

`dev from mid` is the median signed distance from the band midpoint — the band-edge distance is zero for anything inside the band and so cannot reveal a lean within the bands. `noise` is the mean within-fixture sd for that axis.

| Axis | Label | asserted | in band | dev from mid | noise | offset |
|---|---|---|---|---|---|---|
| D1 | Requirement Framing | 9 | 7/9 (78%) | -1.2 | 1.3 | — |
| D2 | Architecture & Component Design | 10 | 9/10 (90%) | 6.3 | 2.0 | — |
| D3 | Tradeoff Reasoning | 9 | 8/9 (89%) | -2.0 | 2.4 | — |
| D4 | Constraint Satisfaction | 10 | 8/10 (80%) | -5.8 | 1.6 | — |
| D5 | Adaptability | 7 | 5/7 (71%) | -1.3 | 3.1 | — |
| K1 | Design-Code Alignment | 5 | 3/5 (60%) | 13.3 | 2.2 | — |
| K2 | Correctness & Edge Cases | 10 | 6/10 (60%) | -11.6 | 2.4 | — |
| K3 | Code Quality & Maintainability | 8 | 7/8 (88%) | -0.8 | 1.6 | — |
| K4 | Security & Defensive Coding | 4 | 3/4 (75%) | -8.5 | 1.7 | — |
| K5 | Testing & Observability | 6 | 4/6 (67%) | -13.8 | 1.2 | +14 |
| K6 | AI Collaboration Quality | 1 | 1/1 (100%) | 0.0 | 0.0 | — |

**Per-axis offsets recommended** (consistent in direction and larger than the noise floor):

- `K5` (Testing & Observability): **+14** — median lean -13.8 against a noise floor of 1.2.

## 4. Scale check — is a rescale needed, or only a shift?

- Fit of observed on expected: **observed = 0.797 x expected + 9.63**
- R² = 0.865
- Expected spread across fixtures: 73 points; observed: 60 points.

Reading:

- **slope ≈ 1, intercept ≈ 0** — calibrated. No normalization; report raw scores.
- **slope ≈ 1, intercept ≠ 0** — a uniform shift. Subtract the intercept; rank order is already right, only the absolute level is off.
- **slope < ~0.8** — scale compression: the judge avoids the extremes and crowds everything toward the middle. This is the common LLM-judge failure and the one that matters commercially, because it is what makes a strong and an average candidate look similar. A per-axis offset cannot fix it — compression needs a linear rescale `(raw - intercept) / slope`, clamped to 0-100.
- **low R² with a sane slope** — the judge is not ordering submissions consistently. Do not normalize; a rescale of a weak ordering just redistributes the same error. Fix the rubric's missing score anchors first.

- Implied error at the ends of the usable range: **6.6** points at expected 15, **-7.6** points at expected 85.

Verdict: **Scale compression (slope 0.797, R² 0.865).** The ordering is sound but the range is squeezed: -7.6 points at the top and 6.6 at the bottom. Do NOT subtract the intercept — with slope < 1 a positive intercept is part of the compression, and subtracting it would push the top end further out. The matching correction is a rescale: `normalized = clamp((raw - 9.63) / 0.797, 0, 100)`.

Before applying any correction, read §6 — a correction fitted to authored bands encodes the band author's taste into every candidate's score.

## 5. Rule compliance (hard assertions)

These follow from explicit instructions in the judge's own system prompt, so a failure is a bug rather than drift, and no offset addresses it.

| Fixture | Axis | Required | Observed | Pass |
|---|---|---|---|---|
| F08 | K4 | 0-20 | 2.0 (2, 2, 2) | yes |
| F08 | D3 | 0-25 | 3.7 (4, 4, 3) | yes |
| F09 | D1 | 0-30 | 32.3 (32, 35, 30) | **NO** |
| F09 | D4 | 0-30 | 5.3 (5, 6, 5) | yes |
| F10 | K6 | 45-55 | 50.0 (50, 50, 50) | yes |

- **F09/D1 failed.** The COHERENCE CHECK clause requires lowering D1 when the Stage 2 design ignores the facts uncovered in Stage 1. Here it proposes the one thing Stage 1 ruled out twice.

## 6. Axis independence (halo check)

The judge is instructed: "Score each axis solely on its own criteria. Do not let one axis's impression affect another's score." These fixtures are strong on one axis and weak on another by construction, so the gap below is a direct measure of whether the eleven axes carry eleven axes' worth of information — which is the entire reason a hiring team wants a breakdown rather than one number.

| Fixture | should hold | mean | should drop | mean | gap | verdict |
|---|---|---|---|---|---|---|
| F02 | D2 | 53.3 | D3, D4 | 11.3 | 42.0 | **CONTAMINATED** |
| F04 | D2, D3, D4 | 64.2 | K1, K2 | 32.0 | 32.2 | separated |

- **F02: D2 did not hold** (53.3, gap to D3/D4 only 42.0). The architecture itself (dedicated service, atomic Lua, correct under 6 containers, observability) is competent engineering and D2 scores 'soundness and clarity of the proposed structure'. Only the cost reasoning is absent, which is what D3 and D4 measure. If D2 falls with them, the judge is scoring an overall impression.

## 7. Limits of this evidence

Read before acting on anything above. The numbers are real measurements; what they license is narrower than it looks.

- **The bands are authored, not panel consensus.** Where the judge sits outside a band, the band may be wrong rather than the judge. This is the single biggest limitation, and it bears directly on the per-axis offsets: an offset fitted to one person's estimates ships that person's taste as if it were measurement.
- **Thin coverage on K1, K4, K6** (K1: n=5, K4: n=4, K6: n=1). A "consistent" lean over 4-5 fixtures is weak evidence; treat any offset on these axes as a hypothesis to test, not a correction to apply.
- **Axes whose fixtures carry little signal read low for a legitimate reason.** If most fixtures ship no tests, a low K5 is the correct score, not a bias — and an offset would then reward submissions that genuinely have no tests. Check what the fixtures actually contain for an axis before correcting it.
- **n=3 runs per fixture.** Enough to show the spread is small; not enough to characterise a tail. A rare pathological run would not appear here.
- **One brief.** Deliberate, so that submission quality is the only variable, but it means these results do not demonstrate stability across problem domains.
