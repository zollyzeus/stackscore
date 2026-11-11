# StackScore

AI-judged, full-stack solutioning assessment. Scores the process (clarify →
propose → build → adapt → debug), not just a final code diff — at both the
design/approach level and the code level — and rolls it into one weighted
consolidated score with a per-skill bar-graph breakdown.

See [PRD.md](./PRD.md) for the full requirements, scoring model, and build plan.

## Stack

- Next.js (App Router) on Cloud Run
- Vertex AI (Gemini) for the stakeholder agent, twist/defect generation, and rubric-constrained judging
- Firestore for sessions/transcripts/scores
- Firebase Auth for candidate/panelist login

## Local dev

```bash
cp .env.example .env.local   # fill in GCP/Firebase values
npm install
npm run dev
```

## Structure

```
data/matrix.json     5x5 problem-generation matrix (rows = design scope, columns = system constraints)
data/rubric.json     10-axis evaluation rubric (5 design + 5 code) + weights
lib/matrix.ts         random (B2C) / manual (B2B) cell selection + stage-4 twist logic
lib/scoring.ts        weighted consolidated StackScore calculation
lib/vertex.ts          Vertex AI calls: brief generation + rubric-constrained judging
app/api/generate-problem   cell selection -> brief
app/api/evaluate            submission -> judge -> score card
app/assessment               5-stage flow shell (scaffold)
app/score/[id]                public shareable score-card page (scaffold)
```
