#!/usr/bin/env bash
# Run once to store secrets in GCP Secret Manager.
# Usage: PROJECT_ID=beaming-crowbar-513808-i4 bash scripts/setup-secrets.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-beaming-crowbar-513808-i4}"
echo "Setting up secrets for project: $PROJECT_ID"

# Helper: create or update a secret
upsert_secret() {
  local name="$1"
  local value="$2"
  if gcloud secrets describe "$name" --project="$PROJECT_ID" &>/dev/null; then
    echo "$value" | gcloud secrets versions add "$name" --data-file=- --project="$PROJECT_ID"
    echo "  Updated $name"
  else
    echo "$value" | gcloud secrets create "$name" --data-file=- --project="$PROJECT_ID" \
      --replication-policy=automatic
    echo "  Created $name"
  fi
}

# Load from .env.local
if [ ! -f .env.local ]; then
  echo "ERROR: .env.local not found — run from project root" >&2
  exit 1
fi

source_var() {
  grep "^$1=" .env.local | head -1 | cut -d= -f2- | tr -d '"'
}

GEMINI_KEY="$(source_var GEMINI_API_KEY)"
ANTHROPIC_KEY="$(source_var ANTHROPIC_API_KEY)"
FIREBASE_KEY="$(source_var FIREBASE_PRIVATE_KEY)"

[ -z "$GEMINI_KEY" ]    && echo "ERROR: GEMINI_API_KEY missing in .env.local" >&2 && exit 1
[ -z "$ANTHROPIC_KEY" ] && echo "ERROR: ANTHROPIC_API_KEY missing in .env.local" >&2 && exit 1
[ -z "$FIREBASE_KEY" ]  && echo "ERROR: FIREBASE_PRIVATE_KEY missing in .env.local" >&2 && exit 1

upsert_secret "GEMINI_API_KEY"      "$GEMINI_KEY"
upsert_secret "ANTHROPIC_API_KEY"   "$ANTHROPIC_KEY"
upsert_secret "FIREBASE_PRIVATE_KEY" "$FIREBASE_KEY"

# Grant Cloud Run service account access to the secrets
SA="stackscore-server@${PROJECT_ID}.iam.gserviceaccount.com"
for secret in GEMINI_API_KEY ANTHROPIC_API_KEY FIREBASE_PRIVATE_KEY; do
  gcloud secrets add-iam-policy-binding "$secret" \
    --project="$PROJECT_ID" \
    --member="serviceAccount:$SA" \
    --role="roles/secretmanager.secretAccessor" \
    --quiet
  echo "  Granted $SA access to $secret"
done

echo ""
echo "Done. Run: gcloud builds submit --project=$PROJECT_ID --config=cloudbuild.yaml ."
