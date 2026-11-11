# StackScore — Audit Follow-up

Consolidated from four audits run 2026-11-11: (1) auth/session, (2) engineering practices,
(3) security, (4) product moat / buildathon positioning. **Remediation pass completed the
same day** — this file now records what was fixed, what was verified, and what is left.

Status key: **[DONE]** fixed + covered by a test · **[VERIFIED]** investigated, no change
needed · **[OPEN]** still outstanding · **[DEFERRED]** deliberately out of scope pre-submission

Test suite: `npx playwright test` — **358 passing locally, 336 passing against production**,
0 failures. Live: https://stackscore.anandrajendran.dev (revision 261111005).

---

## A. Auth / session management

### A1. `ss_panel` auth bypass on transcript + checkpoint — **[DONE]**
`verifySessionToken` returns `null` on failure and never throws, so
`try { await verifySessionToken(t); return true } catch {}` authorised **any** cookie value.
`Cookie: ss_panel=x` read any evaluated candidate's transcript and read/wrote any session's
checkpoint. Fixed in `app/api/transcript/[sessionId]/route.ts` and
`app/api/session/[id]/checkpoint/route.ts` — both now branch on the return value via the new
`getPanelistSession()` helper. Covered by 16 cases in `tests/audit-regression.spec.ts` (§A1),
including forged correct-shape tokens.

### A2. `/api/auth/login` shared-secret backdoor — **[DONE]**
Route deleted. It minted a panelist session for anyone posting `code === PANELIST_SECRET`,
with no registry check and no rate limit — an unthrottled brute-force oracle against the key
that signs all three roles. `tests/auth-setup.ts` no longer depends on it (it mints cookies
directly through `lib/token.ts`). Covered by §A2.

### A3. Unauthenticated candidate-data endpoints — **[DONE]**
`/api/candidate/history` and `/api/trajectory` took an `?email=` parameter with no auth,
exposing any candidate's score history. Both now derive the email from the session cookie and
ignore the query parameter; panelists may still look up a specific candidate. `/api/trajectory`
also switched from `getAllScores(500)` + in-memory filtering to the indexed query. `app/me`
no longer offers an arbitrary-email lookup form. Covered by §A3.

### A4. Tokens never expired — **[DONE]**
`iat` was written but never checked, so a captured cookie was valid forever. The new shared
`lib/token.ts` verifies signature **and** age, rejects a missing `iat`, and rejects
implausibly-future timestamps. Admin sessions shortened to 12h. Covered by §A4 and
`tests/unit.spec.ts`.

### A5. No revocation path for panelists — **[DONE]**
`requirePanelist` only checked the signature, so `active: false` had no effect until the cookie
expired. `getPanelistSession()` now re-checks the live Firestore registry on every request,
matching what `requireAdmin` already did.

### A6. Panelist management was over-permissive and unreachable — **[DONE]**
`/api/admin/panelists` used `requirePanelistOrAdmin`, so by design any panelist could promote
arbitrary emails and deactivate every other panelist — while middleware's IP gate meant they
could never actually reach it, making the dashboard widget dead UI. Now `requireAdmin`, and
`PanelistManager` moved from `/dashboard` to `/admin`. Covered by §A6.

### A7. Open redirect / script sink on login — **[DONE]**
`app/login/page.tsx` assigned an unvalidated `next` parameter to `window.location.href`.
Now restricted to same-origin absolute paths, matching the server-side check already present in
the OAuth callback. Covered by §A7 (4 hostile payloads incl. `javascript:` and `//evil.com`).

### A8. Idle timeout missed admins — **[DONE]**
`IdleGuard` probed only the panelist and candidate endpoints, so an admin console stayed signed
in indefinitely. It now probes and clears all three. Covered by `tests/timeout.spec.ts`
"Idle session timeout — admin (A8)".

### A8b. "Log out now" did not log out — **[DONE]** *(found while testing A8)*
The window-level `mousedown` activity listener fired before React's delegated `click`, setting
`showWarn=false` and unmounting the dialog, so the button's handler never ran — pressing
"Log out now" dismissed the warning and left the session active. `resetIdle` now ignores events
originating inside the dialog. Separately, `doLogout` called `AuthProvider.logout()`, which
navigates to `/login` itself, racing IdleGuard's own navigation; IdleGuard now owns it. The test
asserts the logout endpoint is actually called, not just that the URL changed.

### A9. Non-ASCII names mojibake — **[DONE]**
Regression from the WebCrypto rewrite: `atob()` yields latin1, so `{"name":"José"}` decoded as
`JosÃ©`. `lib/token.ts` decodes through `TextDecoder`. Covered by `tests/unit.spec.ts`
("preserves non-ASCII names", 5 scripts).

### A10. `verify-otp` did not re-check the panelist registry — **[DONE]**
Admin re-checked, panelist did not, so a panelist deactivated between `send-otp` and
`verify-otp` still got a 7-day session. Now re-checked.

### A11. Weak ownership checks on candidate-scoped writes — **[DONE]**
`/api/evaluate` compared emails case-sensitively and skipped the check entirely for sessions
with no `candidateEmail` (every B2C session), so any candidate could trigger a judge run on any
session id. `/api/session-status` had no ownership check at all. Both fixed.
Root cause addressed too: **`/api/session` now stamps the owner from the session cookie** rather
than trusting a client-supplied field, which also stops a candidate claiming a score card under
someone else's address. Covered by §A11.

### A12. Admin/credential keys derive from `PANELIST_SECRET` — **[OPEN — needs you]**
`cloudbuild.yaml` now picks up `ADMIN_SECRET` and `CREDENTIAL_SECRET` automatically **if they
exist**, and warns in the build log when they don't. I could not create them: Secret Manager
writes are blocked for me by a permission policy. Run:

```bash
bash scripts/setup-role-secrets.sh
gcloud builds submit --config=cloudbuild.yaml --substitutions=_ADMIN_IP_ALLOWLIST=<your-ip> .
curl -s https://stackscore.anandrajendran.dev/api/health | grep -o '"ADMIN_SECRET":[a-z]*'
```

Until then the documented fallback is in force: admin tokens and credential signatures use
keys derived from `PANELIST_SECRET`. Role separation holds, but a `PANELIST_SECRET` leak would
compromise all three. `/api/health` reports the current state.

### A13. OTP attempt budget reset on every resend — **[DONE]**
`storeOTP` reset `attempts` to 0, so 3 sends/15min bought 15 guesses. A `windowAttempts`
counter now survives resends, and both read-modify-write paths run in a Firestore transaction.

### A14. Identity echoed into response headers — **[DONE]**
`middleware.ts` no longer sets `x-panelist-name` / `x-admin-email` (identity leak, and a CRLF
in a user-controlled display name made the header write throw). Covered by §A14.

### A15. Inconsistent cookie-clearing options — **[DONE]**
`clearCookieOptions()` omitted `httpOnly`/`secure`/`sameSite`. All three roles now match, and
logout responses are asserted to be `HttpOnly` + expired.

---

## B. Security

### B1. Code sandbox escaped to full `process.env` — **[DONE]**
`vm.createContext({ console })` handed a **host** object into the context, so
`console.log.constructor` was the host `Function`:

```js
console.log(console.log.constructor("return process.env")())
```

returned every API key and signing secret in the process, to any self-signed-up candidate.
Violated PRD NFR4. `lib/sandbox.ts` now builds its console *inside* the context (no host object
crosses the boundary), copies results out as JSON primitives only, caps code size and log
volume, and keeps the wall-clock timeout. 10 escape vectors covered in `tests/sandbox.spec.ts`
plus direct coverage in `tests/unit.spec.ts`.

### B1b. `import()` crashed the container — **[DONE]** *(found while fixing B1)*
`import("fs")` from candidate code raised an **asynchronous** rejection that no try/catch could
see; Node's default is to terminate the process, so one line restarted the Cloud Run container.
Node also ignores `importModuleDynamically` without `--experimental-vm-modules`, and that
variant's TypeError carries **no error code** — a code-only guard missed it. The guard now
matches by code *and* message, swallows only sandbox import rejections, and leaves every other
unhandled rejection fatal. Verified in a bare Node process (4/4 variants contained, exit 0) and
asserted end-to-end by checking `/api/health` still serves afterwards.

### B2. Prompt injection against the judge — **[DONE]**
Five candidate-controlled fields were interpolated into one user turn behind `=== Section ===`
fences the candidate could forge — an attack on the product's core value, not just a security
issue. Now: rubric and instructions moved to the `system` prompt (operator authority), each
field wrapped in `<candidate_*>` tags, tag-like sequences and delimiter runs stripped, an
explicit instruction that tagged content is data, and an injection attempt scored as a negative
signal on K4. Structured outputs (D2) mean the response shape cannot be talked out of.

### B3. Rate limiting was inert — **[DONE]**
`rateLimit` is `async`; `if (!rateLimit(...))` tested a Promise, which is always truthy. Both
call sites (`/api/session`, `/api/demo`) now `await`. The limiter itself was also a
read-then-write race and is now transactional. Covered by §B3 (burst must produce a 429).

### B4. Credit checks were read-then-write races — **[DONE]**
Two concurrent requests both passed the limit, over-spending free credits and double-spending
purchased ones. `lib/freeCredits.ts` and `lib/otp.ts` now use `runTransaction`.

### B5. CSP weak/incomplete — **[DONE]**
Added `base-uri`, `form-action`, `object-src`; dropped `unsafe-eval` from production
(**verified absent on the live service**) while keeping it in dev, where the Next dev server's
React Refresh needs it — removing it outright silently broke hydration and made every page
non-interactive locally, which the suite caught. `poweredByHeader` disabled.

### B6. Missing composite Firestore index — **[VERIFIED]**
The `candidateEmail + createdAt` index already exists in production, so
`/api/candidate/history` was not failing. Added to `firestore.indexes.json` so it is
reproducible from source. A speculative `decision + createdAt` index was removed again —
nothing queries it, and an unused index only costs write amplification.

### B7. Secrets/config in a tracked file — **[DONE]**
`ADMIN_EMAILS` / `ADMIN_IP_ALLOWLIST` moved out of `cloudbuild.yaml` into build substitutions.
`.env.example` now documents every variable including the admin ones (previously undocumented,
so a fresh clone had a silently non-functional admin role).

---

## C. Code / architecture / performance

### C5. Dashboard pulled whole score documents — **[DONE]**
`getAllScores` and `getScoresByEmail` now project only the fields the table renders, keeping
the 8 KB-per-doc `thinkingLog` and design proposal out of list queries. Added `getScoreById`
for the single-card case.

### C6. `/api/trajectory` ignored the indexed query — **[DONE]** (see A3)

### C8. Doc/code drift — **[DONE]**
`CLAUDE.md` and `PRD.md` corrected: 11 axes not 10 (K6 AI Collaboration shipped), the judge is
Claude not Vertex, the generator is `gemini-2.5-flash` not `gemini-1.5-pro`, session creation is
`/api/session`. `CLAUDE.md` gained the auth invariants this audit established (including "never
`try { verifyXToken() } catch {}`" and "always `await rateLimit()`").

### C2. Landing page ships as a client bundle — **[DEFERRED]**
`app/page.tsx` is 25 KB of static marketing content marked `"use client"`. Real win, but it
touches the highest-visibility page two days before submission.

### C1 / C3 / C4 / C7 — **[DEFERRED]**
Two parallel 5-stage implementations (`app/assessment/page.tsx` 40 KB / 32 `useState` vs
`B2BAssessment.tsx` 25 KB / 24 `useState`) are the largest maintainability liability in the
repo and will drift, but deduplicating ~65 KB of interactive UI is exactly the kind of change
that breaks a demo. Likewise the inline-style convention, the accessibility pass, and moving
transcripts to a subcollection (1 MB document ceiling). All documented, none urgent for
submission.

---

## D. AI layer (verified against the `claude-api` skill, not from memory)

### D1. `max_tokens: 4096` truncated the judge — **[DONE]**
Thinking is always on for `claude-opus-5-5` and its tokens count against `max_tokens`. An
11-axis response (scores + feedback + evidence) plus thinking overran it, `JSON.parse` threw,
and a completed five-stage assessment was lost — which is what `/api/retry` and
`/api/re-evaluate` were papering over. Raised to 32 000 (the request already streams, so the
HTTP timeout is not a constraint), and `stop_reason: "max_tokens"` is now detected explicitly.

### D2. Scores were cast, not validated — **[DONE]**
The judge's JSON was fence-stripped with a regex and cast `as AxisScores`. A missing axis
silently became `0` (via `scoring.ts`'s `?? 0`); a string score made `stackScore` `NaN`, which
was then written to Firestore and rendered on a public credential. Now uses structured outputs
(`output_config.format` with a JSON schema generated from the rubric) **and** validates every
axis — range, finiteness, presence — before scoring, failing loudly instead of silently.

### D3. Judge ran at the default effort — **[DONE]**
`claude-opus-5-5` defaults to `effort: "medium"`. The highest-stakes call in the product now
pins `effort: "high"` explicitly.

### D4. PRD's stated consistency mitigation was unimplementable — **[DONE]**
NFR3 claimed "low temperature", but `temperature` is **rejected with a 400** on this model, so
there was no determinism control at all. NFR3 rewritten to describe what is actually enforced
(per-axis prompting, structured outputs, pinned effort, runtime validation) with n-of-k
self-consistency named as the Phase-2 step.

### D5. No prompt caching on an ideally-shaped prompt — **[DONE]**
The instructions + axis list are byte-identical on every evaluation and the volatile candidate
content was already last. `cache_control: {type:"ephemeral"}` on the system block cuts repeat
input cost ~90%.

### D6. Inconsistent failure strategy — **[DONE]**
`judgeSubmission` now retries once before failing (a transient malformed response should not
destroy a five-stage submission) and reports refusals explicitly;
`generateSummaryAndTips` stays non-fatal, since the scores are already computed.

### D7. No eval set — **[OPEN — highest product value]**
PRD §11.3 says the judge "should be spot-checked against known-good/known-bad sample
submissions before demo day". Still no fixtures and no calibration table. See F5.

---

## E. DevOps / rollout

### E1. Build was not reproducible — **[DONE]**
The Dockerfile copied only `package.json` and ran `npm install`, ignoring the committed
lockfile. Now copies both and runs `npm ci`.

### E2. No gate before deploy — **[DONE]**
`cloudbuild.yaml` gained a `verify` step running `npm ci && npx tsc --noEmit` before the image
is built, enforcing what `CLAUDE.md` only asked for.

### E3. Deploys went straight to 100% traffic — **[DONE]**
Now deploys `--no-traffic` with a version tag, probes `/api/health` on the tagged revision, and
promotes only on a 200 — otherwise it fails the build and leaves traffic on the previous
revision. This fired for real on the first run (a malformed probe URL), correctly refused to
promote, and the rollback command is documented in the step.

### E4. Container ran as root — **[DONE]** `USER node`, with `--chown` on the copied artifacts.

### E5. No health/readiness endpoint — **[DONE]**
`/api/health` reports config presence (never values — asserted by a test), Firestore
reachability, and `BUILD_VERSION`. It is what the canary gate probes.

### E6. Secrets pinned to `:latest` — **[DEFERRED]** Fine pre-launch; pin once stable.

### E7. Not a git repository — **[DONE]**
Initialised, `.gitignore` hardened (env files, generated auth state, service-account key
patterns, test artifacts), verified no secret is staged, pushed to
`github.com/zollyzeus/stackscore`. Also added `.gcloudignore` — the build context dropped from
81 MB to 4.7 MB.

---

## F. Product moat & buildathon positioning

### F1. Solo-team eligibility — **[VERIFIED]** Confirmed acceptable 2026-11-11.

### F2. Reframe the Google-AI story — **[DONE in docs, OPEN as a pitch asset]**
Today Gemini (`gemini-2.5-flash`, via an AI Studio key) drives the live assessment engine —
brief, stakeholder agent, twist, defect — and Claude runs the judge. PRD NFR1 now states this
as a deliberate design claim: **the model that authors a problem must not grade the answer, so
the grader is independent of the generator.** That is a stronger story than a single-vendor one.
Still to do: say it on the architecture slide, and decide whether to move generation onto real
Vertex AI (ADC) so "runs on Vertex" is literally true rather than "uses Gemini".

### F3. The honest moat — **[analysis; no code]**
Strip the LLMs and what remains is: the 5×5 matrix (a content taxonomy, published, a day's work
to copy), the 5-stage instrument and 11-axis rubric (real instrument-design IP, but methodology,
and published), the stage-4 twist rule (the sharpest single idea — still a rule), and a Next.js
CRUD app (no moat).

The one compounding asset is the score corpus plus the `decision`/`hiredAt` outcome labels. So
**the moat is neither the AI nor the rubric — it is an outcome-validated score.** A hiring team
pays repeatedly for a number that predicts on-the-job performance, and the only way to own that
is a longitudinal dataset linking StackScore → hire decision → 6/12-month rating. Prompts copy
in an afternoon; that dataset does not.

`setDecision` and `/api/outcome-feedback` already exist and are the most strategically important
code in the repo. **Action:** promote outcome capture from a side feature to the thing the
dashboard nags panelists about, and put "N hires tracked, M with 12-month outcomes" on the
roadmap slide as the metric that compounds.

### F4. The credential network was firewalled off — **[DONE]**
`/api/verify/:slug` is the primitive for a third-party-checkable credential, but CORS was locked
to StackScore's own origin on all of `/api/*` — no external verifier could call the one endpoint
whose entire purpose is external verification. Now `/api/verify/*` is CORS-open (verified live)
while every other route stays same-origin, and the response carries a **signed attestation**:
`lib/credential.ts` HMACs a canonical (key-order-independent) claim set, so a score cannot be
altered in transit or retyped from a screenshot. Covered by §F4 and `tests/unit.spec.ts`.
**Phase 2:** move to an asymmetric key (Ed25519) plus a published JWKS so verifiers can check
offline without calling us — that is what makes it a standard rather than an API.

### F5. Buildathon readiness — **[1 item OPEN]**
Working for it: a real deployed product; AI as the mechanism rather than a wrapper;
process-scoring genuinely differentiated against the LeetCode/CodeSignal field; the matrix +
twist rule showing unusual instrument-design rigor; a strong PRD; and now a 358-test suite with
a canary-gated pipeline.

**Still open, and it is the highest-value remaining item:** no calibration evidence. Judges of an
*assessment* product will ask "how do you know the score is right?" and the repo cannot answer.
Build 8–10 fixture submissions (3 strong, 3 weak, 3 mixed), score each twice, and publish a
table of score, per-axis spread, and run-to-run variance. It closes PRD Risk #3, demonstrates
NFR3 honestly, and is the rigor that separates a demo from a product. Do it before any cosmetic
work.

---

## Known gaps in the remediation

1. **A12** — `ADMIN_SECRET` / `CREDENTIAL_SECRET` not created (Secret Manager writes blocked for
   me). `scripts/setup-role-secrets.sh` does it in one command; the pipeline picks them up with
   no further change.
2. **Secret rotation after B1.** The sandbox escape could have exposed every value in
   `process.env` to anyone who ran code on the deployed service. I did **not** rotate, because
   it invalidates live sessions mid-demo-prep and the provider keys must be regenerated at the
   provider, which I cannot do. If that URL has been shared, rotate: `ANTHROPIC_API_KEY`,
   `GEMINI_API_KEY`, `FIREBASE_PRIVATE_KEY`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`
   (provider-side), then `PANELIST_SECRET` / `CANDIDATE_SECRET` (Secret Manager — this signs
   everyone out once, which is cheap now and not later).
3. **41 tests skip against production**, versus 19 locally. The extra skips are the
   candidate/admin-cookie tests: this machine's `CANDIDATE_SECRET` differs from production's,
   and `ADMIN_SECRET` does not exist yet, so `auth-setup` detects the rejection and skips rather
   than reporting a false failure. Every anonymous/attacker-perspective assertion — the
   security-relevant surface — does run against production. Creating the secrets (item 1) and
   supplying `CANDIDATE_SECRET` in the environment closes the gap.
4. **Deferred by choice:** C1, C2, C3, C4, C7, E6 — see those entries.

## Suggested next steps

1. `bash scripts/setup-role-secrets.sh` + redeploy (A12) — one command
2. Decide on secret rotation (gap 2)
3. Build the calibration table (F5/D7) — highest product value
4. Architecture slide reframe (F2) and the outcome-capture promotion (F3)
5. Post-submission: C1 (dedupe the assessment flow), C2, C4
