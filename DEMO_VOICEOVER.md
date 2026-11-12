# StackScore Demo — Voiceover Script v3

**Accent:** Male, Indian English (confident, measured pace)
**Total target duration:** ~2:30 minutes
**TTS tools:** ElevenLabs / Murf.ai / Play.ht — use "Arjun" or "Rajan" voice preset

---

## Scene 1 — Landing Page (0:00 – 0:12)

> "Most hiring platforms tell you if a candidate can code.
> StackScore tells you if they can engineer.
> It is the first AI-powered assessment platform that scores not just code quality —
> but design thinking, adaptability, debugging, and AI collaboration — all in one number."

---

## Scene 2 — The Eleven Axes (0:12 – 0:22)

> "Every submission is evaluated across eleven independent rubric axes —
> five design axes covering requirement framing, architecture, tradeoff reasoning,
> constraint satisfaction, and adaptability,
> plus six code axes covering implementation quality, correctness, security,
> testing, and AI collaboration —
> producing a single, calibrated StackScore from zero to one hundred."

---

## Scene 3 — Score Card Preview (0:22 – 0:32)

> "The result is a StackScore with design and code sub-scores,
> a radar chart mapping all eleven axes,
> and per-axis judge feedback with evidence quotes —
> not just a number, but a development roadmap with a full audit trail."

---

## Scene 4 — Comparison Table (0:30 – 0:38)

> "HackerRank tests algorithm recall. LeetCode measures syntax under time pressure.
> CodeSignal and Codility evaluate isolated puzzles.
> StackScore is the only platform that evaluates the full engineering thought process —
> from ambiguity scoping, through design, implementation, adaptability, and debugging."

---

## Scene 5 — /why Page (0:38 – 0:44)

> "Real engineering work is never an isolated coding puzzle.
> StackScore mirrors that reality — with a five-stage assessment
> that takes a candidate from ambiguity all the way through debugging a defect in their own system."

---

## Scene 6 — Assessment Start (0:44 – 0:52)

> "Starting is simple. Choose your experience level — Junior, Mid, or Senior —
> and hit Start. Gemini 3.8 Flash generates a fresh, underspecified engineering brief,
> calibrated to the chosen level. No two assessments are the same."

---

## Scene 7 — Clarify Stage (0:52 – 1:02)

> "Stage one: Clarify.
> The candidate converses with an AI stakeholder to scope the problem
> before committing to a design.
> On desktop, the problem brief stays pinned in a sidebar throughout the assessment."

---

## Scene 8 — Hints and Timer (1:02 – 1:08)

> "Candidates can toggle contextual hints for each stage,
> and the overall sixty-minute timer is always visible.
> Inactivity is monitored — progress is auto-saved and can be resumed."

---

## Scene 9 — Build Stage (1:08 – 1:16)

> "Stage three: Build — write a working implementation.
> The in-browser sandbox executes JavaScript live.
> On mobile, the brief collapses into a banner candidates can open at any time."

---

## Scene 10 — Score Card (1:16 – 1:26)

> "After submission, Claude Opus 5.5 with extended thinking
> judges the full submission against the eleven-axis rubric —
> each axis scored independently to prevent halo bias —
> and generates a verifiable score card with per-axis feedback and evidence quotes."

---

## Scene 11 — Score Provenance Banners (1:26 – 1:34)

> "Every score card carries a provenance banner.
> Green means the calibrated AI judge ran successfully.
> Amber means a fallback judge ran and a re-score is queued automatically.
> The system never silently fails — candidates always know the status of their evaluation."

---

## Scene 12 — Calibration Evidence (/benchmarks) (1:34 – 1:42)

> "StackScore's AI judge is verified — not just trusted.
> The benchmarks page shows rank-ordering stability across independent runs —
> Spearman rho of one-point-zero — and cross-validation against a second model, Gemini,
> confirming that the scoring is consistent and unbiased."

---

## Scene 13 — Dashboard, Panel, and Reviewer (1:42 – 1:55)

> "Hiring teams get a live dashboard — shortlist, hold, or reject candidates, export to CSV.
> Panelists create custom assessments assigned to a specific candidate with an expiry window.
> When the AI judge can't reach a confident verdict, a human reviewer task is created automatically.
> The reviewer sees only the submission and rubric anchor bands — never the AI scores —
> so every human review is free of anchoring bias."

---

## Scene 14 — Scenario Bank and Resilience (1:55 – 2:08)

> "And StackScore never goes down during an interview window.
> A pre-generated scenario bank — refilled every two hours by Cloud Scheduler —
> provides instant fallback when Gemini is unavailable.
> Generation flows through Gemini 3.8 Flash, then Claude Haiku 5.5, then the bank,
> then a static template — four tiers of resilience, zero candidate-facing downtime."

---

## Scene 15 — Compare and History (2:08 – 2:16)

> "Side-by-side radar comparison makes hiring decisions defensible.
> Candidates track their own trajectory across multiple attempts.
> Every score is immutable, shareable, and auditable —
> a permanent engineering record that travels with the candidate."

---

## Scene 16 — Closing on Landing (2:16 – 2:26)

> "StackScore is the full picture of an engineer — in one number.
> Not what they memorised.
> How they think, design, adapt, and debug.
> Try it free at stackscore dot anandrajendran dot dev."

---

## Production Notes

- Record screen: `RUN_LIVE_AI=1 npx playwright test tests/demo-capture.spec.ts --config=playwright.demo.config.ts`
- Output video saved to `test-results/demo-video/`
- Merge screen recording + voiceover audio in DaVinci Resolve / CapCut / iMovie
- Title card at 0:00: "Other platforms tell you if the candidate can code. StackScore tells you if they can engineer."
- Add lower-thirds: scene label + current stage name
- Highlight the provenance badge and benchmarks page — these are the key MOAT differentiators
- Export: 1920×1080, MP4 H.264, max 100 MB for Hack2skill upload
- Target total runtime: 2:20–2:30
- New scenes to capture: scenario bank admin view (/admin → scenario-bank stats), reviewer /review/[id] page (blur out scores), provenance badge close-up
