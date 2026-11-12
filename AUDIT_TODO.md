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

### A12. Admin/credential keys derive from `PANELIST_SECRET` — **[DONE 2026-11-12]**
`ADMIN_SECRET` and `CREDENTIAL_SECRET` now exist in Secret Manager, each with one enabled
version, and are wired into the service. Verified on revision `261112001`:
`/api/health` reports `"ADMIN_SECRET": true, "CREDENTIAL_SECRET": true`, so the
`PANELIST_SECRET`-derived fallback is no longer in use and a `PANELIST_SECRET` leak no
longer compromises admin sessions or credential signatures.

Two things were wrong on the way and are worth keeping:

1. **`scripts/setup-role-secrets.sh` granted the wrong principal.** It used
   `stackscore-server@`, which is `FIREBASE_CLIENT_EMAIL` — the identity the Admin SDK
   authenticates as, which never reads Secret Manager. The Cloud Run *runtime* identity is
   the default compute SA. The first patched revision therefore failed to start with
   `SECRETS_ACCESS_CHECK_FAILED` while the previous revision kept serving — so the deploy
   looked like it had succeeded until the serving revision was checked. The script now
   derives the project number and grants `<number>-compute@developer.gserviceaccount.com`.
2. **`gcloud` is broken on this machine**, which is why `scripts/deploy-rest.sh` exists —
   see E8.

`/api/health` now also reports `CREDENTIAL_SECRET`, which it previously omitted, so the
fallback state is observable rather than inferred.

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
Claude not Vertex, the generator is `gemini-3.8-flash` not `gemini-1.5-pro`, session creation is
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

### D7. No eval set — **[DONE 2026-11-12]**
PRD §11.3 wanted the judge "spot-checked against known-good/known-bad sample submissions
before demo day". Built: 10 fixtures over one shared brief, a runner, and a committed
baseline. See `data/calibration/README.md`; dataset in `data/calibration/fixtures.ts`,
runner in `tests/calibration.spec.ts` (its own Playwright project, self-skips unless
`RUN_CALIBRATION=1`, ~$4 for a 30-call sweep).

Baseline (`claude-opus-5-5`, effort `high`, 3 runs x 10 fixtures, 30/30 calls succeeded):

- **Reliable.** Mean StackScore sd **1.0 point**, worst range 5; three fixtures identical
  across all three runs. This was the question that bounded all the others.
- **Rule-compliant.** All 5 hard assertions pass — K6 exactly 50/50/50 with no AI evidence,
  the injection fixture scored K4 1.7 / D3 2.7 / overall 11, and the coherence check fires.
- **8/10 fixtures in band**, both misses low rather than high.
- **Mild compression**: `observed = 0.835 x expected + 5.09`, R² 0.868 — about **-9 points
  at the top of the range**, with the ordering sound.
- **K2/K4/K5 graded far harder** than every other axis (median lean -16.4 / -12.0 / -17.2;
  all others within ~3). Most likely over-generous labels rather than a judge defect.
- **Halo within the design level**: F02's D2 fell to 32.3 on a competent architecture whose
  only gap was the cost reasoning that D3/D4 already measure. Level separation is fine
  (F04: 42-point design-to-code gap); within-level independence is not.

**Recommendation: ship raw scores, apply no normalization.** Both computed corrections are
fitted to authored bands, so applying either would encode one person's taste as measurement.
The real fix is upstream: `data/rubric.json` gave each axis a one-line description and a
0-100 scale and **never said what 40 meant versus 60 or 80**.

**Anchors added 2026-11-12** (see D10) — four contiguous bands per axis, rendered into the
judge's system prefix. The baseline above is therefore **pre-anchor and stale**, and the
sweep has not been re-run, so the anchors' effect is an expectation, not a result.

Finding the bug below was worth more than the calibration numbers themselves.

### D8. Judge was entirely non-functional in production — **[FIXED 2026-11-12 — was CRITICAL]**
Found by the first calibration call, not by the 358-test suite, because every existing test
mocked the judge rather than calling it.

`responseSchema()` emitted `minimum: 0, maximum: 100` on the integer score fields.
Structured outputs rejects numeric range keywords outright:

```
400 invalid_request_error - output_config.format.schema:
For 'integer' type, properties maximum, minimum are not supported
```

`judgeSubmission()` treats a 400 as retryable, retries once, then throws — so **every
scoring call failed**, at the *last* step of a completed five-stage assessment. The
product's core function did not work at all.

**Correction (2026-11-12, found while answering "is it deployable"):** this entry first
recorded the consequence as "destroying the whole submission". That is wrong, and the truth
is worse. `app/api/evaluate/route.ts` catches the throw and substitutes mechanical fallback
scores (20 for each axis with content, 0 for each without, K6 = 50). So during the outage
candidates did not get an error — they got a **plausible-looking StackScore around 20** that
was persisted, shown on the public score page, emailed to the panelist and posted to the
webhook, with nothing anywhere marking it as not-a-real-score. See D11.

Fixed by removing the two keywords; the 0-100 bound is stated in the system prompt and
enforced in `validateJudgeOutput()`, which clamps. The schema guarantees shape, validation
guarantees range. A comment in `lib/judge.ts` says not to re-add them. Deployed in
`261112001` and confirmed by 30 successful judge calls.

Lesson: a suite can be green and prove nothing about the one call that matters. The
calibration sweep is now the only test that exercises the real judge end to end.

### D9. Two tests passed for the wrong reason — **[FIXED 2026-11-12]**
Both found by running the suite in a shell that did *not* export `PANELIST_SECRET`. They had
been passing only because of how the suite happened to be invoked, which makes them evidence
of nothing.

1. **`unit.spec.ts` "credential signing" (4 tests) depended on a production secret.**
   `lib/credential.ts` resolves its key from `CREDENTIAL_SECRET` or `PANELIST_SECRET` on every
   call and throws when neither is set, so these four *failed outright* with no secret in the
   environment. Wrong dependency for a unit test: the properties under test — tamper
   detection, key-order independence — hold for any key. The block now supplies its own test
   key and restores the previous value afterwards. All 30 unit tests now pass with an empty
   environment.
2. **`assessment.spec.ts`'s three panelist UI blocks failed instead of skipping.** They set
   `storageState` directly with no guard, so with no cookie minted the state was an empty
   jar, every `/panel` navigation 307'd to `/login`, and the UI assertions failed with a
   misleading "element not found" — which reads as a product regression and cost real time to
   run down. They now use the `test.skip(!tokens().panelToken, ...)` pattern that
   `audit-regression.spec.ts` already used.

Worth stating plainly: a test that fails when its preconditions are absent is as misleading
as one that passes when it should not. The first costs time, the second costs trust.

### D10. Rubric had no score anchors — **[DONE 2026-11-12]**

The root cause behind calibration Findings 1 and 2 (see D7). Each axis in `data/rubric.json`
carried a `label`, a `weight` and a one-line `description`, and the judge was asked for a
number on a 0-100 scale that nothing anywhere defined. Whatever consistency it achieved was
its own invention rather than the rubric's — and an undefined scale is not a scale a hiring
team can act on.

`data/rubric.json` now carries, per axis, four **contiguous** anchor bands (`0-24`, `25-49`,
`50-74`, `75-100`), plus a top-level `scale.note`. `lib/judge.ts` renders all of it into the
system prompt, which is the cached prefix, so the added ~1.8k tokens are billed at the cache
read rate after the first call of a session.

Four decisions worth keeping, each traceable to a measured finding:

- **Contiguous rather than gapped bands.** The conventional form ("0-20 …, 40-60 …, 80-100
  …") leaves 21-39 and 61-79 undefined — exactly the mid-range most submissions occupy, and
  exactly where an undefined scale does the most damage.
- **The top band is declared reachable.** `scale.note` states that `75-100` describes what a
  strong engineer produces *inside a timed assessment*, not a flawless artifact, and that an
  axis with no identified defect belongs there. Left to itself an LLM judge reserves 90+ for
  hypothetical perfection — which is Finding 1's compression (slope 0.835, ≈-9 at the top).
- **K2/K4/K5 each name `50-74` as "the expected bar for a timed submission".** Targeted at
  Finding 2 (those three graded 12-17 points harder than everything else). This is the
  clause most likely to have overshot and the first thing to check in the next sweep.
- **Axis independence moved into the per-axis text.** D2 gained a `scoredElsewhere` note —
  "a competent architecture that ignores the budget is a high D2 and a low D3/D4, not a
  mediocre everything" — which is Finding 3 stated where the judge reads it while scoring
  D2, instead of once in a preamble it has already passed.

Also reconciled a conflict this exposed: the K6 paragraph in the system prompt hardcoded
"score 20-40 / score 70-90", which would have contradicted the anchor bands. The prompt now
keeps only the rule the anchors cannot express (no AI evidence → exactly 50) and defers the
rest to the bands.

**Measured 2026-11-12** (`data/calibration/post-anchor-report.md`, 30 calls, same model /
effort / fixtures as the baseline, so the rubric is the only changed variable). **Mixed, and
the sweep gate now fails — see D12. Do not ship this scale to candidates as it stands.**

Worked: halo largely fixed (F02's D2 32.3 → 53.3 while D3/D4 held at 11.3 — the
`scoredElsewhere` line was the most effective thing added); the over-strict axes relaxed
toward their bands (K4 +9.2, K5 +3.9, K2 +2.6 mean; K4's recommended offset disappeared,
K5's fell +17 → +14); reliability improved (sd 1.0 → 0.8); F01 and F02 band deviations
shrank from -7.0/-6.0 to -4.7/-1.0.

Overshot: every fixture rose (mean +2.9) but the weak ones rose most (F07 13.3 → 17.7, F08
11.0 → 14.0, F09 35.0 → 43.7, vs F01 +2.3), so **slope got worse, 0.835 → 0.797**, and the
bottom-end implied error went +2.6 → +6.6. The `scale.note` clause did not lift the ceiling;
the "expected bar" clauses lifted the floor. R² held at 0.865, so ordering is intact.

**One real design flaw surfaced and deliberately not fixed:** on K6, `50` now means both
"AI use was reviewed" (the `50-74` band) and "no AI evidence — cannot assess" (the rule).
Those are different statements wearing the same number, and a panelist reading `K6: 50`
cannot tell which they got. The honest fix is a null/not-assessed state distinct from the
0-100 scale, which is a schema and UI change across `AxisScores`, the score page and the
weighted sum — out of scope for an anchors change, and it would alter how the StackScore is
computed for every submission with no AI evidence. Flagged rather than smuggled in.

### D12. Anchors introduced two scoring regressions — **[FIXED 2026-11-12]**

Measured by the post-anchor sweep (see D10). Both are defects in the anchor text I wrote,
not in the judge, and both have precise causes.

**D12a — the coherence rule stopped firing on D1. Hard-assertion failure, so the sweep gate
is red.** F09/D1 requires 0-30; observed **32.3** (runs 32, 35, 30; previously 28, 30, 30).
Cause: D1's anchors describe *question quality only*, and F09's Stage 1 questions are
genuinely good — its failure is that Stage 2 ignores their answers. The COHERENCE CHECK
clause in the system prompt requires lowering D1 for exactly that, but the anchor text sits
immediately beside the axis and won the conflict.

The general lesson is worth more than the fix: **an anchor that omits a rule silently
overrides it.** Anchors are the most specific instruction the judge has about an axis, so
any rule stated elsewhere in the prompt must be restated in the anchors of every axis it
constrains, or it stops applying there. D4 did not regress (5.3) precisely because its
anchors happen to align with the coherence requirement rather than cut across it.

**D12b — K1 is now vacuously generous.** K1's median lean went +1.3 → +13.3, driven by F07
(the near-empty fixture) scoring K1 35 → **52**. The `50-74` anchor reads "The code follows
the proposal", which is trivially satisfied when there is almost no code and almost no
proposal. Absence of evidence is being read as alignment.

**Both fixed and re-measured; the sweep gate now passes** (5/5 rule compliance, 30/30 calls,
R² 0.848, 8/10 band compliance).

- D12a: restated the coherence rule as a `note` on D1, applied as a cap before the bands are
  read. F09/D1 is now 28.7 against the required 0-30.
- D12b: K1's low bands now say that too little material to establish alignment scores low,
  not middle. F07's K1 went 52.0 → 32.3, below its pre-anchor 35.0.
- D12c: softened the "expected bar for a timed submission" language on K2/K4/K5, which had
  over-delivered. The weak fixtures came back down (F07 17.7 → 16.3, F08 14.0 → 12.3).

Deliberately **not** chased, and recorded as such in `data/calibration/README.md`: slope is
0.799 against a pre-anchor 0.835, so compression did not improve. Closing that gap means
tuning against bands one person authored, which §7 of the report says not to do. K1's
residual +14.7 lean is largely an artifact — the median K1 fixture (F04, 34.7) is *inside*
its band of [5, 35], and the lean measures distance from a wide band's midpoint.

The lesson worth keeping is from D12a: **an anchor that omits a rule silently overrides it.**
Anchors are the most specific instruction the judge has about an axis, so any rule stated
once in the preamble must be restated in the anchors of every axis it constrains. D4 never
regressed only because its anchors happen to align with the coherence requirement rather
than cut across it.

### D13. Degraded-judge pipeline and blind human review — **[DONE 2026-11-12]**

Replaces D11's mechanical fallback with a three-stage flow, tracked by `judgeStatus`:

| status | meaning | shown as |
|---|---|---|
| `judged` | the calibrated judge scored it | normal |
| `partial` | calibrated pass failed; an **uncalibrated** judge pass produced these | "Partially judged, subject to change" + re-judge queued |
| `pending_review` | both passes failed | "On hold for human verification", no numbers at all |
| `reviewed` | a human scored it against the same rubric | "Human reviewed", authoritative again |

The uncalibrated pass is a genuinely *different* attempt, not a retry: the likeliest causes
of a calibrated failure are the prompt's size and the structured-output schema it drives, so
re-running the identical prompt mostly reproduces the identical failure. And model judgement,
even uncalibrated, beats placeholder arithmetic.

The re-judge queue is Firestore-backed rather than an in-process retry. Judge failures are
rarely instantaneous-transient — a 400, an outage, an exhausted quota all outlast a request —
and a durable task survives the process, retries with backoff, and leaves a **countable
record of how often the judge fails**, which is the signal D8 needed and a silent in-process
retry would have hidden. After `MAX_REJUDGE_ATTEMPTS` it escalates to human review rather
than burning calls forever.

**The bias boundary is enforced server-side**, in `/api/review/submission`: it returns the
brief and the candidate's five stages and withholds `axisScores`, `stackScore`,
`levelScores`, `feedback`, `evidence`, `thinkingLog`, `summary`, `tips` and `judgeUsage`. A
page that received the scores and declined to render them would already have lost — the data
would be in the HTML, in the network tab, and one careless refactor from being shown.

The review form shows the rubric **including the anchor bands**, which is what D10's anchors
are for: a 0-100 scale that means the same thing to a human as to the judge. Every axis must
be scored before submission; a partially-filled form is rejected rather than defaulting the
missing axes to zero, which would read as a deliberate "worth nothing" judgement nobody made.

Held cards suppress the headline number, the level rollups **and the radar**. Eleven zeroed
axes draw a collapsed shape that reads as "scored terribly" rather than "not scored", and the
picture carries further than the banner above it.

### D14. Calibration monitor and scoring hold — **[DONE 2026-11-12]**

Two questions, two mechanisms:

1. **"Has the thing being calibrated changed?"** — a fingerprint over `data/rubric.json` plus
   the judge's model and effort. Free and instant. The rubric is in the hash because its
   anchors are rendered into the system prompt: editing an anchor *is* editing the judge
   (D10). Without this the repo keeps citing committed sweep numbers for a judge that no
   longer exists.
2. **"Is the judge still obeying its own rules?"** — a live probe of only the hard-assertion
   fixtures, once each: 3 calls, ~$0.40, against the full sweep's 30 calls and ~$4. Those
   follow from explicit instructions in the judge's own prompt, so a failure is a bug rather
   than drift. Band compliance, slope and R² are **not** checked here — they need the full
   sweep's statistical power.

A probe that cannot reach the judge is recorded as an **outage, not a calibration failure**.
Conflating them would pause scoring over a network blip.

The hold is controlled from the **admin console**, not an env var: it has to be switchable
during an incident, and an env var means a redeploy — the slowest possible way to react, and
it needs someone at a terminal rather than at the admin page.

Two separate switches, deliberately: *"let the monitor pause scoring automatically"*
(default **off**) and *"pause scoring now"*. Collapsing them would hide the dangerous case —
an operator could not tell whether they were stopping the pipeline now or arming an
automation to stop it later, unattended. A manual hold is recorded as non-automatic so a
passing probe cannot silently override an operator's decision.

**While held, candidates still complete and submit.** That is non-negotiable: nobody loses an
hour of five-stage work to an operational decision. Submissions queue in `pendingScoring` and
are drained by a worker that refuses to run while the hold is active, since draining into a
paused pipeline produces exactly the results the pause existed to prevent.

Firestore being unreachable returns "not held" rather than failing closed — an infrastructure
blip must not stop the product scoring.

**Not yet live:** every worker endpoint fails closed without `TASK_RUNNER_SECRET`, which does
not exist yet (the create was classifier-denied). Run `scripts/setup-task-secrets.sh`, then
`scripts/deploy-rest.sh`, then `scripts/setup-schedulers.sh`, in that order.

### D11. Judge failure silently produced a fake score — **[FIXED 2026-11-12 — was the highest-severity open item]**

Found 2026-11-12 while assessing deployment readiness. Not a regression; it has always
behaved this way, and it is what made D8 survive in production instead of paging someone.

`app/api/evaluate/route.ts:76` catches any `judgeSubmission` throw and substitutes
mechanical scores — 20 per axis that has content, 0 per axis that does not, K6 = 50 — with
generic per-axis feedback ("Code was submitted."). That scorecard is then treated exactly
like a real one: `computeScoreCard` runs on it, `saveScore` persists it, the public
`/score/{slug}` page renders it, the panelist notification email quotes the number, and the
`assessment.completed` webhook posts it downstream. **Nothing in the stored document records
that the judge never ran** — `saveScore`'s `meta` has no such field, so the fallback is
unrecoverable after the fact, including for the scores already written during the D8 outage.

Why this is the worst open item rather than a rough edge:

- A candidate is told they scored ~20 on a real assessment. For a hiring product that is a
  false negative delivered with full confidence, and it is invisible to everyone involved.
- It defeats the monitoring that exists. `/api/health` reports the service healthy because
  the service *is* healthy; the judge is a downstream dependency whose failure is swallowed.
  The only trace is a `console.error` line in Cloud Run logs with no alert on it.
- It converts an outage into bad data. An error is recoverable — the candidate retries. A
  persisted fake score is not, and it propagates to the webhook consumer immediately.

The fallback itself is defensible: losing a completed five-stage submission is genuinely
bad, which is the reasoning in D6. The defect is that the fallback is **indistinguishable
from a real result**. Minimum fix, roughly in order of value per unit of work:

1. Persist `judgeFallback: true` (plus the error reason) through `saveScore`, and add the
   field to the `scores` schema and the panel's allowed-field list in `lib/firestore.ts:149`.
2. Mark it on `/score/[id]` and in the panelist email — a scorecard the judge did not
   produce must not present as one.
3. Exclude fallback scores from the dashboard, `/benchmarks` and `/compare` aggregates, or
   they silently drag every cohort statistic toward 20.
4. Alert on it: a counter or a log-based metric on the `[evaluate] judge failed` line. This
   is the piece that would have caught D8 on the first real submission.
5. Reconsider whether the candidate should instead be offered a retry, which keeps the
   submission and avoids inventing a number at all.

**Fixed.** A judged card and a substituted one are now distinguishable everywhere a score is
presented or counted:

- `judgeFallback` / `judgeFallbackReason` persist through `saveScore` and are projected in
  `SCORE_LIST_FIELDS`, so list queries can see the flag.
- `/score/[id]` renders a banner **above** the number, not beside it — a reader who sees the
  figure first has already drawn the conclusion.
- The panelist email carries a banner and a `[JUDGE FAILED - not a real score]` subject
  prefix, because a subject line is all a panelist sees in a notification list.
- The `assessment.completed` webhook carries `judgeFallback` so consumers can discard it.
- `isJudgedScore()` in `lib/firestore.ts` quarantines fallbacks from every statistic:
  `/benchmarks` excludes them outright, the score page's percentile and axis medians exclude
  them from the peer set, and the dashboard keeps the rows listed (a panelist needs to see a
  failed submission) while removing them from the headline stats and showing a count.
- The log line now carries a `JUDGE_FALLBACK` token to alert on — the piece that would have
  caught D8 on the first real submission.

Five unit tests cover the quarantine, including that only a real boolean `true` excludes: a
stray truthy value must not silently drop a genuine score out of every statistic.

**Still open, deliberately:** the candidate is not offered a retry, so a fallback card is
still created rather than the submission being held. Flagging it is the smaller fix and the
one that stops the silent-bad-data failure; offering a retry is the better product answer
and a larger change to the assessment flow.

---

### A16. Admin IP allowlist removed; admin signs in via OTP or Google — **[DONE 2026-11-12]**

The allowlist pinned admin access to one residential IP. It failed closed and *invisibly*
every time that address changed: the app served normally and the admin console simply
vanished, which happened on 2026-11-12 and cost a redeploy. A control that reliably locks
out the legitimate operator, while doing nothing against anyone who can reach the origin
from an allowed network, is not buying the depth it appears to.

**This is a real reduction in defence depth — two factors to one — so the identity checks
behind it now carry the full weight:**

- an admin session is only minted for an address on the admin registry, checked identically
  in `send-otp`, `verify-otp` and the Google callback;
- `requireAdmin()` and `requirePanelistOrAdmin()` re-check the registry on **every** request,
  so revoking an admin takes effect immediately rather than at token expiry;
- admin sessions remain 12h against the panelist 7d.

Google sign-in can now mint an admin session, gated by the same registry.

The admin tests improved as a side effect, and the improvement is the tell that the
allowlist was load-bearing in the wrong way. They had been written as
`expect([403, 200]).toContain(status)` — which passes when the endpoint *serves the page* —
and skipped against production because the runner's IP was not allow-listed. Both
weaknesses came from the allowlist. They now assert 307 to `/login?type=admin`, 401 on every
admin API, rejection of forged cookies, and no anonymous self-grant via `POST
/api/admin/admins`, and they run against prod.

### A17. Reviewer role (fourth identity) — **[DONE 2026-11-12]**

`ss_reviewer` cookie, a `reviewers` registry an admin manages, OTP and Google both gated by
it. Deliberately **not** a flag on panelists: a panelist can already see AI scores across the
dashboard, and a review is only worth having if it was produced without them. Separating the
identity makes that structural rather than a promise about a UI.

`lib/reviewerAuth.ts` is split three ways — auth / `reviewerRegistry` / `requireReviewer` —
because `middleware.ts` imports it to verify the cookie and middleware runs on the Edge
runtime, which cannot load `firebase-admin`. A dynamic import was **not** enough: webpack
bundles it anyway, so the dependency has to be absent, not deferred.

### D15. Three copies of the submission mapping, all wrong — **[FIXED 2026-11-12]**

Found by the first real end-to-end run of the scoring path. The judge reported "No code was
submitted" for a transcript that contained code, because the transcript stage is `build` and
the reader asked for `implement`.

That particular instance was a bug in the throwaway test script, but the same mistake was
sitting in three files written the same day, where it was a live production defect:

| File | What it would have done |
|---|---|
| `app/api/tasks/rejudge/route.ts` | Re-judged a `partial` score with **no code**, so every K axis reads as unassessable and the "fixed" score is *worse* than the provisional one it replaced |
| `app/api/tasks/drain-pending/route.ts` | Same, for anything queued during a scoring hold |
| `app/api/review/submission/route.ts` | Showed the human reviewer an empty code stage, so they would correctly conclude the candidate submitted nothing |

Two of the three also dropped the revised code a candidate writes after the twist, which is
some of the strongest adaptability evidence in the submission.

**Nothing failed loudly.** The judge scores an empty submission perfectly happily and simply
reports that no code was submitted — the same shape as D8 and D11: a wrong answer delivered
with full confidence, where an error would have been recoverable.

Fixed with a single `lib/submissionInput.ts` rather than three patched copies. This is C1's
"parallel implementations drift" in miniature, created and corrected on the same day, which
is a reasonable argument for taking C1 seriously post-submission. Seven unit tests pin the
stage names, the twist-code composition and the no-code placeholder.

### D16. Dead score links: noindex yes, 404 no — **[PARTIALLY FIXED 2026-11-12]**

`/score/<bogus>` rendered the "not found" page with **HTTP 200** — a soft-404. It now calls
`notFound()`, which renders the page properly and makes Next emit
`<meta name="robots" content="noindex">`, so a dead shared link cannot be indexed. Score
links are public and get passed around, so that was the part that mattered.

**The status is still 200 and in Next 14 it cannot be anything else.** App Router streams
dynamically-rendered pages, so the status line is flushed before the component resolves;
`notFound()` can still choose the body but not the status. Verified rather than assumed:
removing the segment's `loading.tsx` left it at 200, removing `not-found.tsx` left it at
200, and an unmatched route like `/totally/bogus` still 404s correctly — so it is the
streaming boundary, not a missing not-found boundary. `loading.tsx` was restored once that
hypothesis was disproved.

What is still wrong: a programmatic client branching on `res.ok` reads a missing score card
as a present one. Nothing in this repo does that today. The real fix is to move the slow
peer-statistics work (`getAllScores(500)`, for the percentile block) into a `<Suspense>`
child so the shell resolves before streaming starts; recorded in `page.tsx`.

The tests assert what is actually guaranteed — right body, no score furniture, `noindex` —
rather than a status the framework will not produce. Asserting the 404 would have been
asserting a wish.

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

### E8. `gcloud` unusable locally; REST deploy path added — **[WORKED AROUND]**
Every `gcloud` command that makes an API call (`gcloud secrets`, `gcloud builds submit`,
`gcloud run`) exits **120 with no output at all** — nothing on stdout, nothing on stderr, no
traceback. `gcloud version`, `gcloud auth list` and `gcloud auth print-access-token` all work,
so the credentials are fine; `--log-http` shows the request being constructed and the process
dying at the HTTP call. Environment: snap `google-cloud-cli` 593.0.0 on Python 3.14.9. It is
gcloud's HTTP layer, not this project.

Worked around rather than fixed, since it is not ours to fix:

- `scripts/deploy-rest.sh` — tars the source, stages it in the Cloud Build bucket, and creates
  the build over REST with curl. It **converts `cloudbuild.yaml` rather than reimplementing
  it**, so the canary gate (deploy `--no-traffic`, probe `/api/health` on the tagged revision,
  promote only on success) still applies. A deploy path that skipped that gate would have been
  the wrong thing to build in a hurry.
- Secret Manager writes went through the Secret Manager REST API with the same token.

Both are workarounds. Delete `scripts/deploy-rest.sh` once `gcloud` works; `cloudbuild.yaml`
remains the single source of truth for the deploy either way.

---

### E9. Build version numbers can repeat and go backwards — **[OPEN — cosmetic, but breaks rollback]**

The 2026-11-12 13:35 deploy produced version **`261112000`**, deployed as revision
`stackscore-00065-yur` and now serving 100% of traffic — but the *previous* deploy that day
was `261112001`. The newest code carries a lower version string than the code it replaced.

`cloudbuild.yaml`'s `compute-version` step derives the sequence by listing today's image
tags and incrementing the highest. A `000` suffix is not reachable from either branch of
that logic (an empty result yields `001`, a found tag yields at least `002`), so `SEQ`
evaluated to empty and `printf '%03d'` turned that into `000`. The step swallows errors with
`2>/dev/null`, so whatever failed left no trace, and the build reported success.

Why it matters beyond tidiness: the version string is how a human picks a rollback target.
With `261112001` ordering *above* the newer `261112000`, "roll back to the previous version"
selects the wrong revision, and the tagged canary URLs (`v261112000---…`) inherit the same
confusion. Revision numbers (`00065`) are still monotonic, so recovery is possible — it just
cannot be driven off the version tag.

Fix: drop `2>/dev/null` so a failed `list-tags` is visible, and fail the build when `SEQ` is
empty rather than formatting it as zero. A version this scheme cannot compute should stop
the deploy, not label it.

## F. Product moat & buildathon positioning

### F1. Solo-team eligibility — **[VERIFIED]** Confirmed acceptable 2026-11-11.

### F2. Reframe the Google-AI story — **[DONE in docs, OPEN as a pitch asset]**
Today Gemini (`gemini-3.8-flash`, via an AI Studio key) drives the live assessment engine —
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

**Calibration evidence — [DONE 2026-11-12].** "How do you know the score is right?" now has an
answer in the repo: `data/calibration/` holds 10 fixtures, a runner, and a committed baseline
with per-axis spread and run-to-run variance. Closes PRD Risk #3 and demonstrates NFR3. Full
results in D7.

The headline for a pitch is the reliability number: **mean StackScore sd of 1.0 point across
three runs** of the same submission, with all 5 rule-compliance assertions passing — including
a prompt-injection attempt that scored 11/100. That is a defensible claim, and it is stronger
than a claim of accuracy would be, because accuracy rests on authored labels while reliability
is measured directly.

Say the limitation out loud rather than waiting to be asked: the expected bands are one
person's judgements, not panel consensus, so the dataset currently demonstrates *consistency*
and *rule-following*, not *correctness*. The named next step — panel re-labelling — is a
credible roadmap item rather than a gap.

The dataset has also already paid for itself twice, which is the better story: it found a
total production scoring outage (D8) that a 358-test green suite had hidden, and it diagnosed
a missing-anchors root cause that is now fixed (D10). That is what a calibration harness is
*for* — the numbers it reports are the smaller half of its value.

---

## Known gaps in the remediation

1. **The calibration bands are authored, not panel consensus.** This is the most important
   caveat in the repo now, because it is the one most likely to be over-read. The dataset
   demonstrates that the judge is *consistent* and *follows its stated rules*; it does not
   establish that the scores are *correct*. Do not apply the per-axis offsets the report
   computes until 2+ panelists have re-scored the fixtures blind. See `data/calibration/README.md`.
2. ~~Admin locked out by an empty `ADMIN_IP_ALLOWLIST`~~ — **resolved 2026-11-12 by
   removing the allowlist entirely (A1).** Admin now signs in via OTP or Google, gated by
   the admin registry. See A16.
3. **Secret rotation after B1.** The sandbox escape could have exposed every value in
   `process.env` to anyone who ran code on the deployed service. I did **not** rotate, because
   it invalidates live sessions mid-demo-prep and the provider keys must be regenerated at the
   provider, which I cannot do. If that URL has been shared, rotate: `ANTHROPIC_API_KEY`,
   `GEMINI_API_KEY`, `FIREBASE_PRIVATE_KEY`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`
   (provider-side), then `PANELIST_SECRET` / `CANDIDATE_SECRET` (Secret Manager — this signs
   everyone out once, which is cheap now and not later).
4. **Judge coverage is thin outside calibration.** Every test other than the calibration
   sweep mocks the judge, which is exactly why D8 — total scoring failure in production —
   survived a 358-test green suite. The calibration project is the only thing that exercises
   the real judge, and it does not run by default because it costs money. Run it after any
   change to `lib/judge.ts`.
5. **41 tests skip against production**, versus 19 locally. The extra skips are the
   candidate-cookie tests: this machine's `CANDIDATE_SECRET` differs from production's, so
   `auth-setup` detects the rejection and skips rather than reporting a false failure. Every anonymous/attacker-perspective assertion — the
   security-relevant surface — does run against production. Creating the secrets (item 1) and
   supplying `CANDIDATE_SECRET` in the environment closes the gap.
6. **A judge failure still creates a card rather than offering a retry.** It is now clearly
   marked everywhere and excluded from every statistic (D11), so it no longer produces
   silent bad data, but the better product answer is to hold the submission.
7. **No token-usage instrumentation.** `msg.usage` is never read anywhere, so the per-call
   cost, the prompt-cache hit rate and the effect of D10's +2.5k system-prompt tokens are
   all unmeasured. Every cost figure in this document is an estimate, including that one.
8. **Deferred by choice:** C1, C2, C3, C4, C7, E6 — see those entries.

## Suggested next steps

1. ~~D11 — judge-failure fallback presenting as a real score~~ — **done 2026-11-12.**
2. ~~D12 — the two anchor regressions~~ — **done 2026-11-12**, sweep gate green.
3. ~~Token-usage instrumentation~~ — **done 2026-11-12 (B4), and it answered its own first
   question on the first real call:** `cacheCreationTokens: 5692, cacheReadTokens: 0`. The
   ephemeral (5-minute) prompt cache was written and never read, costing a 1.25x write
   premium it never recovers — about **$0.0057 per call, ~$5.70 per thousand assessments**.
   **Deliberately NOT acted on yet.** That is one sample, and the mechanism can flip in the
   direction that favours keeping it: two assessments finishing within five minutes with the
   same role *would* hit the cache. Acting on n=1 is the same error this document warns
   against for K1's lean and for the fitted offsets. Collect a handful more calls — the
   logging is already there — then decide.
4. **Create `TASK_RUNNER_SECRET` and wire the schedulers** — until then A3's re-judge queue
   and B5's monitor are inert (they fail closed, so this is safe, not broken). Three scripts,
   in order: `setup-task-secrets.sh`, `deploy-rest.sh`, `setup-schedulers.sh`.
5. Architecture slide reframe (F2) and the outcome-capture promotion (F3).
6. Panel re-label the calibration fixtures (gap 1), then re-run and reconsider normalization.
7. Post-submission: C1 (dedupe the assessment flow), C2, C4.

Secret rotation after B1 was **declined on 2026-11-12**: nothing has been rolled out to
end users, and the B1 sandbox tests verify that candidate code cannot reach `process.env`,
`fetch` or any host-bridging global. That reasoning covers the current sandbox; it does not
cover the window before B1 was fixed, which is acceptable only because the URL was never
shared.
