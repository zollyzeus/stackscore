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
SA="stackscore-server@${PROJECT_ID}.iam.gserviceaccount.com"

echo "Project: $PROJECT_ID"

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
    --substitutions=_ADMIN_IP_ALLOWLIST=<your-ip> .

Then confirm the app is using the dedicated keys:
  curl -s https://stackscore.anandrajendran.dev/api/health | grep -o '"ADMIN_SECRET":[a-z]*'
  # expect "ADMIN_SECRET":true

Setting ADMIN_SECRET invalidates existing admin sessions (they were signed with the
PANELIST_SECRET-derived key), so sign in to /admin again afterwards.
EOF
