#!/usr/bin/env bash
#
# Creates the per-role signing secrets that cloudbuild.yaml picks up automatically.
#
#   bash scripts/setup-role-secrets.sh
#
# Why these should exist (AUDIT_TODO.md A12):
#   lib/adminAuth.ts and lib/credential.ts fall back to deriving a namespaced key from
#   PANELIST_SECRET when their own secret is absent. The namespace stops a token for one
#   role being replayed as another, but it does NOT contain a PANELIST_SECRET leak — with
#   the fallback in play, that one value compromises admin sessions and credential
#   signatures too. Giving each role its own key removes that shared blast radius.
#
# cloudbuild.yaml checks for each secret and uses it when present, so no YAML change is
# needed after running this — just redeploy.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-beaming-crowbar-513808-i4}"

# The principal that must be able to READ these secrets is the Cloud Run *runtime* service
# account -- the identity the revision runs as. The service does not set
# template.serviceAccount, so that is the project's default compute SA.
#
# It is NOT stackscore-server@: that is FIREBASE_CLIENT_EMAIL, the identity the Admin SDK
# authenticates as using FIREBASE_PRIVATE_KEY. It never reads Secret Manager. Granting it
# instead of the runtime SA produces a revision that fails to start with
# SECRETS_ACCESS_CHECK_FAILED, while the previous revision keeps serving -- so the deploy
# looks like it succeeded until you check which revision has traffic.
#
# Derived rather than hardcoded so this is not wrong again in another project.
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo "Project: $PROJECT_ID ($PROJECT_NUMBER)"
echo "Runtime service account: $SA"

for name in ADMIN_SECRET CREDENTIAL_SECRET; do
  if gcloud secrets describe "$name" --project="$PROJECT_ID" &>/dev/null; then
    echo "  $name already exists — leaving it alone"
  else
    # 32 random bytes, hex-encoded. printf (not echo) so no trailing newline is stored.
    printf '%s' "$(openssl rand -hex 32)" \
      | gcloud secrets create "$name" \
          --project="$PROJECT_ID" \
          --data-file=- \
          --replication-policy=automatic
    echo "  created $name"
  fi

  gcloud secrets add-iam-policy-binding "$name" \
    --project="$PROJECT_ID" \
    --member="serviceAccount:$SA" \
    --role="roles/secretmanager.secretAccessor" \
    --quiet >/dev/null
  echo "  granted $SA access to $name"
done

cat <<'EOF'

Done. Next:
  gcloud builds submit --config=cloudbuild.yaml \

Then confirm the app is using the dedicated keys:
  curl -s https://stackscore.anandrajendran.dev/api/health \
    | grep -o '"\(ADMIN\|CREDENTIAL\)_SECRET":[a-z]*'
  # expect both true

A revision that cannot read a secret does NOT take traffic, so also confirm the new
revision is the one serving -- otherwise health is reporting the old revision:
  gcloud run services describe stackscore --region=us-central1 \
    --format='value(status.traffic)'

Setting ADMIN_SECRET invalidates existing admin sessions (they were signed with the
PANELIST_SECRET-derived key), so sign in to /admin again afterwards.
EOF
