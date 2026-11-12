# StackScore — Product Requirements Document

**Status:** v1 (initial requirements recorded + scoped to detailed requirements in the same pass)
**Owner:** solo founder/builder
**Target:** Startup Buildathon India 2026 — applications close 2026-11-13
**Repo:** `/media/anand/WD BLACK/projects2/stackscore`

---

## 1. Problem & USP (recap)

Existing technical assessment tools either score isolated algorithm puzzles (LeetCode, CodeSignal), score realistic tasks but only via slow human grading gated behind B2B contracts (Woven, Byteboard), or run AI-graded conversational interviews that documented sources show degrade specifically on open-ended system design.

**StackScore** scores the full solutioning *process* — clarify, propose, build, adapt, debug — with an AI judge, at both the **design/approach level** and the **code level**, and shows the candidate a bar-graph breakdown per skill plus one weighted consolidated score they own and can share.

---

## 2. Users & Modes

| Mode | User | Problem selection |
|---|---|---|
| **B2C (self-serve)** | Individual candidate, free/self-initiated run | App **randomly** picks one cell from the 5×5 problem matrix |
| **B2B (panel-assisted)** | Interviewer/panelist running a structured interview | Panelist **manually selects** the row + column (and optionally a difficulty modifier) before the session starts |

Both modes reuse the same generation, submission, and scoring pipeline — only the selection step differs. This is a config flag (`selectionMode: "random" | "manual"`) on session creation, not a separate code path.

---

## 3. Problem Generation Matrix (5×5)

The matrix is the core content engine. Each cell = one **Design Scope** (row) × one **System Constraint** (column). A session is seeded by a cell reference (e.g. `R2×C4`); an LLM prompt template expands the cell into a concrete, ambiguous problem brief at runtime (so the same cell never produces a verbatim-identical brief twice — mitigates memorization/answer-sharing).

### Rows — Design Scope (what to build)

| ID | Scope | Representative seeds |
|---|---|---|
| R1 | **Data-Intensive Service** | URL shortener, file storage/sharing, leaderboard/ranking, key-value cache tier, content archive |
| R2 | **User-Facing Workflow** | Signup/onboarding, checkout flow, booking/reservation system, multi-step form with save-and-resume, subscription management |
| R3 | **Real-Time / Event-Driven System** | Chat/messaging, live notification feed, pub/sub order pipeline, presence/status system, live collaborative editing |
| R4 | **Integration / API Layer** | Third-party payment integration, webhook ingestion service, multi-service orchestration/saga, external data-sync connector, public API gateway |
| R5 | **Admin / Operational Tooling** | Internal moderation queue, batch reporting/export job, feature-flag/config service, audit-log viewer, scheduled-job orchestrator |

### Columns — System Design Constraints (the pressure applied)

| ID | Constraint | Representative pressure |
|---|---|---|
| C1 | **Scale & Performance** | Sudden 10x traffic spike, sub-100ms read SLA, high write throughput, global/multi-region latency |
| C2 | **Reliability & Fault Tolerance** | Must survive single-region outage, idempotent retries, graceful degradation, no data loss on crash |
| C3 | **Consistency & Data Integrity** | Concurrent write conflicts, exactly-once processing, schema evolution without downtime, auditability |
| C4 | **Security & Compliance** | PII encryption at rest, multi-tenant isolation, abuse/rate-limit prevention, right-to-erasure deletion |
| C5 | **Cost & Operability** | Fixed serverless budget, must be observable/monitorable, zero-downtime deploys, maintainable by a 1–2 person team |

25 cells total. Example: `R1×C4` → "design a file-sharing service with PII-compliant storage and strict multi-tenant isolation." `R3×C1` → "design a live notification feed that survives a 10x spike during a flash event."

**Stage 4 ("Adapt") twist generation rule:** the mid-task constraint change is always drawn from a *different* column than the one originally assigned, so the candidate's design is tested against a second pressure it wasn't built for — this is what actually measures adaptability rather than rote pattern application.

---

## 4. Assessment Flow (5 stages)

1. **Clarify** — AI stakeholder agent presents the generated brief (deliberately underspecified); candidate asks scoping questions.
2. **Propose** — candidate commits to an approach/architecture + justifies tradeoffs *before* writing code. (Design/Approach evaluation input.)
3. **Build** — candidate implements a working slice in the embedded sandbox. (Code evaluation input.)
4. **Adapt** — a constraint-change twist (from a different column) is injected; candidate revises approach and/or code.
5. **Debug** — a seeded defect in a part of the system the candidate didn't author; candidate must locate and fix it. (Code evaluation input.)

---

## 5. Evaluation Model

Two levels, five axes each. Level 2 is explicitly scored in reference to Level 1 — i.e. "does the code strengthen/comply with the stated design" is itself a scored axis, not just a vibe.

### 5.1 Level 1 — Solution Design / Approach (from stages 2 + 4)

| Axis | What it measures |
|---|---|
| D1. Requirement Framing | Quality of clarifying questions; did they scope the real ambiguity in stage 1? |
| D2. Architecture & Component Design | Soundness and clarity of the proposed structure |
| D3. Tradeoff Reasoning | Explicit justification of choices against the assigned column constraint |
| D4. Constraint Satisfaction | Does the design actually hold up against the assigned constraint (not just mention it) |
| D5. Adaptability | How well the design absorbs the stage-4 twist — patched vs. re-architected from scratch vs. collapsed |

### 5.2 Level 2 — Code-Level Best Practices (from stages 3 + 5)

| Axis | What it measures |
|---|---|
| K1. Design-Code Alignment | Does the implementation actually match what was proposed in stage 2 — flags drift/contradiction |
| K2. Correctness & Edge Cases | Does it work, including boundary/failure conditions |
| K3. Code Quality & Maintainability | Naming, modularity, separation of concerns |
| K4. Security & Defensive Coding | Input validation, secrets handling, authz checks — weighted up when C4 is the assigned column |
| K5. Testing & Observability | Tests written, error handling, logging/instrumentation present |

### 5.3 Weighting & Consolidated StackScore

- Level weighting (MVP default, configurable): **Design 55% / Code 45%** — reflects that solutioning judgment is the primary differentiator being sold, code quality is the complement.
- Within each level, axes are weighted equally by default (Design: 11% each; Code: 9% each).
- **StackScore = Σ(axis_score × axis_weight)**, axis scores 0–100.
- **Phase 2 (not MVP):** dynamic reweighting — the axis matching the assigned column constraint (e.g. K4 for a C4 session) gets an up-weighted multiplier, since that's the skill the session was specifically designed to pressure-test. Documented here for roadmap credibility; static weights ship for the buildathon demo.

### 5.4 Score card

- 11 horizontal bars (D1–D5, K1–K6), 0–100, grouped visually into "Design" and "Code" clusters.
- One large consolidated **StackScore** number (0–100) above the bars.
- Narrative feedback per axis (1–2 sentences from the judge LLM), not just the number.
- Public, shareable URL per completed run (candidate-owned credential — the B2C→B2B funnel hook).

---

## 6. Functional Requirements

| ID | Requirement |
|---|---|
| FR1 | System can generate a problem brief from a given or randomly-selected matrix cell via LLM expansion |
| FR2 | B2C sessions auto-select a random cell; B2B sessions accept an explicit cell + optional difficulty modifier from the panelist |
| FR3 | Candidate can conduct a clarifying Q&A with an AI stakeholder agent before design submission |
| FR4 | Candidate can submit a text/diagram design proposal |
| FR5 | Candidate can write and run code in an embedded sandboxed environment |
| FR6 | System injects a stage-4 constraint twist drawn from a column different from the original |
| FR7 | System injects a seeded, reproducible defect for the debug stage |
| FR8 | Judge pipeline scores all 11 axes (D1–D5, K1–K6) from the stage transcripts/artifacts and returns schema-validated JSON + narrative feedback |
| FR9 | System computes the weighted consolidated StackScore from axis scores |
| FR10 | Candidate gets a persistent, public, shareable score-card page |
| FR11 | Panelist (B2B) can review the same score card plus full transcript for audit/override |

## 7. Non-Functional Requirements

| ID | Requirement | Notes |
|---|---|---|
| NFR1 | AI-powered core, not bolted on | **Gemini** (`gemini-3.8-flash`) drives the live assessment engine: brief generation, the stakeholder agent, twist injection and defect seeding. **Claude** (`claude-opus-5-5`) runs the judge. The split is deliberate — the model that authors a problem must not grade the answer, so the grader is independent of the generator. Satisfies "must be AI-powered" + "use of Google AI" |
| NFR2 | Runs on GCP | Cloud Run (app + sandbox), Firestore (sessions/scores), Firebase Auth (login) — satisfies "technical architecture" criterion |
| NFR3 | Judge consistency | Same submission scored twice should land within a small tolerance band. `temperature` is **rejected by `claude-opus-5-5`**, so consistency is enforced instead by: (a) per-axis rubric-constrained prompting, (b) **structured outputs** (`output_config.format` JSON schema) so the response shape is fixed, (c) a pinned `effort: "high"`, and (d) runtime validation of every axis before scoring. Phase 2: self-consistency (score n=3, report median + spread) — see `tests/judge-calibration.spec.ts` for the measured variance |
| NFR4 | Sandbox isolation | Candidate code execution must not escape its container; no access to other sessions' data. **MVP status:** `lib/sandbox.ts` builds its console *inside* the vm context so no host object (and therefore no host `Function`, no `process.env`) is reachable, denies dynamic `import()`, caps code size/log volume, and enforces a wall-clock timeout; verified by `tests/sandbox.spec.ts`. Full isolation (separate secret-free Cloud Run Job / gVisor) remains Phase 2 |
| NFR5 | Session cost bound | One run (brief gen + agent dialogue + judge pass) should stay within a predictable Vertex AI token budget — needed since B2C is free-tier |

---

## 8. System Architecture

```
Browser (Next.js app, Cloud Run)
   |
   |-- /api/generate-problem  -> picks matrix cell (random or manual) -> Vertex AI (Gemini) expands to brief -> Firestore (session doc)
   |-- /api/stakeholder-chat  -> Vertex AI agent turn, grounded in the brief + prior Q&A -> Firestore (transcript)
   |-- /api/run-code          -> candidate code -> sandboxed execution (Cloud Run job / gVisor) -> stdout/result -> Firestore
   |-- /api/inject-twist      -> picks a column != original -> Vertex AI generates twist text -> Firestore
   |-- /api/inject-defect     -> seeds a known defect variant into the candidate's code snapshot -> Firestore
   |-- /api/evaluate          -> gathers all stage artifacts -> Claude judge (rubric-constrained prompt, 11 axes, structured outputs) -> validated JSON -> scoring.ts computes StackScore -> Firestore (score doc)
   |-- /score/[id]            -> public score-card page, reads score doc
```

Firebase Auth gates session creation (candidate identity) and B2B panelist accounts; the public score-card route is unauthenticated read-only by design (it's the shareable artifact).

---

## 9. Data Model (Firestore)

- `matrixCells` — static reference data: `{ id, row, column, rowLabel, columnLabel, seedExamples[] }`
- `sessions` — `{ id, mode: "b2c"|"b2b", cellId, twistCellId, candidateId|panelistId, status, createdAt }`
- `transcripts` — `{ sessionId, stage, turns[] }` (clarify Q&A, design proposal text, code snapshots, debug notes)
- `scores` — `{ sessionId, axisScores: { D1..D5, K1..K6 }, weights, stackScore, feedback: { D1..D5, K1..K6 }, publicSlug }`

---

## 10. MVP Scope (8-day buildathon demo)

**Must (ships by Nov 13):**
- Full 5-stage flow for **one flagship matrix cell** (not all 25) end-to-end
- Random selection logic implemented (code real, even if only one cell is content-complete for the demo)
- Manual-selection UI stubbed for B2B (shows the matrix picker even if only the flagship cell has full content)
- Real Vertex AI judge producing real 10-axis scores + consolidated StackScore
- Score-card page with the bar graph
- Architecture diagram + pitch deck

**Should (if time allows):**
- 2–3 more matrix cells fully content-complete
- Seeded-defect variety (more than one bug template)

**Won't (explicitly deferred, documented for the pitch's roadmap slide):**
- Dynamic constraint-based reweighting (Section 5.3 Phase 2)
- B2B verification/API product (the Phase-2 monetization layer)
- Multi-language code sandbox (ship one language for MVP — pick based on flagship cell)
- Anti-cheating/proctoring

---

## 11. Risks & Open Items

1. ~~**Team size clause**~~ — *resolved 2026-11-11: solo entry confirmed acceptable.*
2. **IP clause** — T&C grants the organiser a 6-month right of first refusal on submitted materials; worth being aware of before submitting if there's any intent to raise/sell StackScore independently shortly after.
3. **Judge reliability on open-ended design** — the exact weakness documented against competitors; mitigated by rubric-constrained (not freeform) per-axis prompts plus structured outputs. Calibration harness lives in `tests/judge-calibration.spec.ts` (fixtures in `tests/fixtures/submissions/`): run it to produce the score/variance table before demo day.
4. **Flagship cell choice** — needs to be chosen next; should be something a judge "gets" in 30 seconds and that exercises both design and code axes clearly.

---

## 12. Build Plan (Nov 5 → Nov 13)

| Day | Focus |
|---|---|
| 1–2 | Finalize flagship cell + rubric prompts; stand up GCP project (Vertex AI, Firestore, Cloud Run, Firebase Auth); scaffold repo (this doc + initial code structure) |
| 3–5 | Build the 5-stage flow, stakeholder agent, sandbox, judge pipeline |
| 6 | Score-card page + landing page (states Phase-2 B2B vision) |
| 7 | Deck, architecture diagram, demo recording (buffer) |
| 8 | Submit |
