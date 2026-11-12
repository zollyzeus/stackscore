# Panel re-label runbook

The single most important open item on the calibration dataset.

Every accuracy claim in `README.md` — "8/10 in band", slope 0.799, "K5 leans −15.8" — is
measured against **75 bands written by one person**. Reliability (run-to-run sd 0.8–1.2) is
independent and real. Accuracy is not. Until this runbook is executed, the defensible claim
is *"the judge is consistent and follows its stated rules"*, never *"the judge is accurate"*.

## What the panel does and does not fix

**Fixes:** whether the authored bands are generous, harsh, or about right — and therefore
whether findings like "K2/K4/K5 are graded 12–17 points too hard" describe the judge or
describe the labeller.

**Does not fix:** thin coverage. K4 has 3 bands, K1 has 5, and **K6 has none at all** — it is
validated only by the F10 rule check, so its accuracy is entirely unmeasured. No amount of
re-labelling creates evidence the fixtures do not contain; that needs new fixtures. Nor does
it address the single shared brief, which is deliberate but means none of this demonstrates
stability across problem domains.

## 1. Recruit

Two graders minimum, **three is materially better**: with two, a disagreement is just a
disagreement; with three you can see whether one grader is systematically harsh, and you get
a median rather than a midpoint. The step from 2→3 buys more than 3→4.

Qualification is having made real hire/no-hire calls on engineers at these levels — not
familiarity with this rubric.

**The dataset's author must not be a blind grader.** They have seen the bands and the judge's
output and cannot unsee them. If they grade at all, they do it first and are recorded as a
separate non-blind grader.

## 2. Generate the packs

```bash
npx tsx scripts/make-panel-pack.ts --graders 3 --out ./panel-pack
```

Produces `grader-1.html` … `grader-N.html` plus `pack-key.json`.

**Send each grader only their own HTML file. `pack-key.json` is operator-only** — it is the
letter→fixture mapping, and it is the only file in the pack that contains a fixture id.

What the packs deliberately withhold: the authored bands, the judge's scores and feedback,
the fixture `label` and `rationale` (*"Senior — strong design, blind to the assigned
constraint"* hands over the answer), the hard assertions, and the fixture ids themselves.
Order is shuffled per grader and fixtures are relabelled A–J, because the canonical order
descends roughly by quality (F01 ceiling → F07 floor) and a grader who notices starts
anchoring on it.

What they deliberately include: the rubric **with its anchor bands**. That is the point of
the anchors — a 0–100 scale that means the same thing to a human as to the judge. Comparing
a human who invented their own scale against a judge reading anchors measures nothing.

Each pack is 110 cells (10 submissions × 11 axes), ~6,800 words of reading. Budget **2–3
hours**, ideally one sitting so the grader's own calibration does not drift between the first
submission and the last. Progress is saved in the browser as they type.

## 3. Score independently

Graders must not discuss until everyone has submitted. Agreement reached by conversation
tells you nothing about whether the axis has a real answer.

**"Cannot assess" is a first-class answer**, offered on every axis. A guessed 50 is noise
that will be mistaken for data. Graders score all 11 axes, including the 35 slots left blank
in the authored set — that choice was itself a judgement, and if graders consistently score
an axis that was omitted, the omission was wrong.

Each grader clicks *Download my results* and sends back `panel-grader-N.json`.

## 4. Merge — and read section 1 before anything else

```bash
npx tsx scripts/merge-panel-results.ts ./panel-pack/pack-key.json ./results/*.json
```

Three sections, in a deliberate order:

**1. Inter-grader agreement.** Read this *before* looking at any judge output, or you will
unconsciously read the agreement in the judge's favour. Expect every axis to exceed the
judge's 1.2-point sd by a wide multiple — humans disagree more than an LLM varies on reruns,
which is normal and not a defect. What matters is the absolute spread:

| mean spread | meaning |
|---|---|
| ≤ 4 | the graders agree; a point estimate is defensible |
| 4–8 | usable band, some drift |
| 8–15 | a point estimate is shaky |
| > 15 | **publish a range on this axis, not a point** |

An axis where two qualified graders land 20 points apart is one where the product should
report a range. **That is a finding, not a failure** — and a stronger claim than false
precision, because it is one you can defend when a hiring team pushes back.

**2. Proposed bands**, `[min, max]` across graders, ready to paste. Where every grader said
"cannot assess", the band is **absent, not `[0, 0]`** — scoring zero would punish a candidate
for something the fixture never asked them to demonstrate.

**3. Panel vs the authored bands**, per axis: positive means the authored band was harsh
(and the judge may have been right all along), negative means it was generous (and the
judge's strictness was justified).

## 5. Apply, re-run, then decide on normalization

Paste section 2 into `data/calibration/fixtures.ts`, **keeping the originals as
`expectedAuthored`** so the before/after stays auditable — the provenance of these numbers
is the whole point.

Re-run the full sweep (~$4, ~10 min):

```bash
RUN_CALIBRATION=1 CALIBRATION_RUNS=3 npx playwright test --project=calibration
```

Only now do the headline numbers mean what they appear to mean:

- **Slope** (0.799 against authored bands). If it moves toward 1.0, the authored bands were
  compressed rather than the judge.
- **The K2/K4/K5 strictness.** Section 3 settles whether it was bias or correctness.
- **Normalization.** A rescale fitted to panel consensus is a defensible correction. One
  fitted to a single author's estimates ships that person's taste as measurement, which is
  why none has been applied to date.

Note that editing `fixtures.ts` does not change the judge, so the calibration fingerprint is
unaffected — but editing `data/rubric.json` does, and the daily monitor will say so.
