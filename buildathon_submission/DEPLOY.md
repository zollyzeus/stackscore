# Deployment checklist — StackScore Buildathon submission

## ⚠️ BEFORE you push / submit the live URL

1. **Rotate the Anthropic API key** — the key was shared in conversation history.
   - Go to https://console.anthropic.com → API Keys → revoke old key → create new
   - Update `.env.local` with the new key
   - Run `bash scripts/setup-secrets.sh` to push updated key to Secret Manager

2. **Service account JSON** — moved to `~/beaming-crowbar-513808-i4-e7f6349cad26.json` ✓
   - Never put it back in the project root

## Deploy to Cloud Run

```bash
# 1. Store secrets in GCP Secret Manager (run once)
PROJECT_ID=beaming-crowbar-513808-i4 bash scripts/setup-secrets.sh

# 2. Build and deploy via Cloud Build
gcloud builds submit \
  --project=beaming-crowbar-513808-i4 \
  --config=cloudbuild.yaml .

# 3. Get the live URL
gcloud run services describe stackscore \
  --region=us-central1 \
  --project=beaming-crowbar-513808-i4 \
  --format='value(status.url)'
```

## What was built (7-day roadmap)

| Item | Status |
|------|--------|
| 5-stage assessment workflow (Clarify → Propose → Build → Adapt → Debug) | ✅ |
| Dual-AI: Gemini 3.8 Flash (generation) + Claude Opus 5.5 (judging) | ✅ |
| 10-axis rubric, weighted StackScore | ✅ |
| Bulletproof error handling at every stage | ✅ |
| Score card page `/score/[slug]` with axis breakdown | ✅ |
| Landing page with features + panel CTA | ✅ |
| Per-stage countdown timer (configurable, 1-min warning) | ✅ |
| Fresher hints mode (togglable per-stage tips) | ✅ |
| Role selector (Junior / Mid / Senior) — calibrates judge | ✅ |
| HR/panelist dashboard `/dashboard` with pass/fail threshold | ✅ |
| Cloud Run Dockerfile + cloudbuild.yaml + Secret Manager script | ✅ |
| UI polish: chat bubbles, Fira Code editor, animated stage progress bar | ✅ |
| Playwright test suite: 26 tests passing | ✅ |
| Pitch deck (10 slides) | ✅ |
| Service account JSON moved out of project root | ✅ |
| **Rotate Anthropic API key** | ⚠️ PENDING |
