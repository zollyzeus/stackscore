# StackScore — Claude Code Guide

> AI-judged full-stack solutioning assessment. Buildathon deadline: **2026-11-13**.

## Project snapshot

| | |
|---|---|
| Stack | Next.js 14 App Router · TypeScript · Firestore · Firebase Auth |
| AI — generation | Gemini 3.8 Flash via `@google/genai` (`lib/vertex.ts`), Claude Haiku 5.5 fallback |
| AI — evaluation | Claude claude-opus-5-5 w/ adaptive thinking (`lib/judge.ts`) |
| Compute | GCP Cloud Run (`Dockerfile`, `output: standalone`) |
| Path | `/media/anand/WD BLACK/projects2/stackscore` |

## Key product concepts (read before touching AI prompts)

- **5×5 problem matrix**: rows = design scopes (R1–R5), columns = system constraints (C1–C5). Each cell is a unique problem configuration. `data/matrix.json`.
- **5-stage flow**: Clarify → Propose → Build → Adapt → Debug. Stage 4 twist **must** use a different column than the original assignment (`lib/matrix.ts → twistColumn`).
- **11-axis rubric**: D1–D5 (design, 55% total weight) + K1–K6 (code, 45% total weight — K6 is AI Collaboration Quality). Weights in `data/rubric.json`. **Dynamic reweighting is Phase 2 — do not enable it.**
- **Judge isolation invariant**: each axis in `judgeSubmission` must be scored **independently**. Never merge axis prompts or add cross-axis comparisons — this causes holistic-impression bleed, the documented failure mode for AI rubric graders.
- **MVP flagship cell**: R2 × C1 (user-facing workflow, scale spike). Used for demos and testing.

## File map

```
lib/
  token.ts        shared HMAC sign/verify + token expiry (Edge-safe: WebCrypto only)
  auth.ts         panelist session (ss_panel)
  candidateAuth.ts candidate session (ss_cand)
  adminAuth.ts    admin session (ss_admin, 12h)
  requirePanelist.ts / requireAdmin.ts  route guards (re-check live registries)
  credential.ts   signs public score attestations
  matrix.ts       randomCell, manualCell, twistColumn, flagshipCell
  scoring.ts      computeScoreCard — clamping, weighted sum, level rollups
  vertex.ts       Vertex AI helpers: generateBrief, stakeholderReply, generateTwist, generateDefect
  judge.ts        Claude claude-opus-5-5 judge: judgeSubmission (DO NOT use Vertex for this)
  firestore.ts    Firebase Admin CRUD: createSession, getSession, appendTranscript, saveScore, getScoreBySlug
  sandbox.ts      Node vm executor: runJavaScript (MVP only)

app/
  page.tsx                   Landing page (placeholder → needs content)
  assessment/page.tsx        5-stage "use client" assessment UI
  panel/page.tsx             B2B panelist matrix picker
  score/[id]/page.tsx        Public shareable score card (unauthenticated)
  api/session/               Creates session + brief
  api/stakeholder-chat/      Clarify stage Q&A
  api/run-code/              Build/debug sandbox execution
  api/inject-twist/          Stage 4 twist injection
  api/inject-defect/         Stage 5 bug seeding
  api/evaluate/              Full judge pass → score persistence
  api/verify/[slug]/         Public, CORS-open, signed credential verification
  api/health/                Readiness probe used by the deploy smoke test

data/
  matrix.json     All 5 rows + 5 cols with seeds/pressures arrays
  rubric.json     10-axis definitions + weights

tracking/
  sessions.json   Claude Code session log (see below)
```

## Development

```bash
npm install
cp .env.example .env.local   # fill in credentials
npm run dev                  # http://localhost:3000

npx tsc --noEmit             # type-check (must be clean before every deploy)
```

## Environment variables (`.env.local`)

```
GCP_PROJECT_ID=
GCP_LOCATION=us-central1
VERTEX_MODEL=gemini-3.8-flash
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
GEMINI_API_KEY=               # for lib/vertex.ts (generation)
ANTHROPIC_API_KEY=            # for lib/judge.ts (Claude claude-opus-5-5)

PANELIST_SECRET=              # HMAC key for ss_panel tokens
CANDIDATE_SECRET=             # HMAC key for ss_cand tokens  (set explicitly in prod)
ADMIN_SECRET=                 # HMAC key for ss_admin tokens (set explicitly in prod)
CREDENTIAL_SECRET=            # signs /api/verify attestations
PANELIST_EMAILS=              # bootstrap panelist registry (comma-separated)
ADMIN_EMAILS=                 # bootstrap admin registry (comma-separated)
ADMIN_IP_ALLOWLIST=           # REQUIRED for admin access — fails closed when unset
```

See `.env.example` for the full annotated list.

## GCP deployment

```bash
docker build -t stackscore .
docker tag stackscore gcr.io/$GCP_PROJECT_ID/stackscore
docker push gcr.io/$GCP_PROJECT_ID/stackscore
gcloud run deploy stackscore \
  --image gcr.io/$GCP_PROJECT_ID/stackscore \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --port 8080
```

## Claude Code session tracker

Log each session in `tracking/sessions.json` after every conversation ends.
Fields: `id`, `date` (ISO), `type` (planning|implementation|debugging|deployment), `description`, `inputTokens`, `outputTokens`.
Token estimates come from the Claude Code usage display or the Anthropic console.

## Conventions

- TypeScript strict mode — no `any`, no `@ts-ignore`
- Server components by default; use `"use client"` only where needed (assessment/page.tsx, panel/page.tsx, MatrixPicker)
- All AI calls go through `lib/` — no direct SDK calls in route files
- API routes return `NextResponse.json(...)` — no `Response.json()`
- Firestore calls use Firebase Admin SDK (`lib/firestore.ts`) — never the client SDK server-side
- Keep `judgeSubmission` in `lib/judge.ts` only — Gemini is for generation, Claude is for evaluation
  (deliberate: the model that authors a problem must not grade the answer)
- **Auth**: never `try { await verifyXToken(t); return true } catch {}` — the verifiers
  return `null` on failure and never throw, so that pattern authorises everyone. Branch on
  the return value.
- **Auth**: route guards must re-check the live Firestore registry, not just the signature,
  so deactivating a panelist/admin takes effect immediately.
- Candidate-scoped data is always derived from the session cookie, never from a query
  parameter or request body.
- `rateLimit()` is async — always `await` it.
- Judge calls use structured outputs (`output_config.format`) and validate every axis
  before scoring; `temperature` is rejected by `claude-opus-5-5`, use `effort` instead.

## Buildathon requirements checklist

- [x] Uses Google AI (Vertex AI / Gemini) — brief gen, stakeholder, twist, defect
- [x] Demonstrates a clear product use case — solutioning assessment
- [x] Has a novel USP — process scoring + candidate-owned credential
- [x] Deployed to GCP (Cloud Run)
- [ ] Public demo URL working
- [ ] Pitch deck ready — target 2026-11-12
