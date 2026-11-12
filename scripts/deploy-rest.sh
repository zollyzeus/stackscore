#!/usr/bin/env bash
#
# Submit cloudbuild.yaml to Cloud Build over the REST API.
#
#   bash scripts/deploy-rest.sh
#
# WHY THIS EXISTS
# `gcloud builds submit` (and `gcloud secrets`, and every other gcloud command that makes
# an API call) dies with exit 120 and no output at all -- nothing on stdout, nothing on
# stderr, no traceback -- on the snap google-cloud-cli 593.0.0 running under Python 3.14.
# `gcloud version`, `gcloud auth list` and `gcloud auth print-access-token` still work, so
# the credentials are intact; it is gcloud's HTTP layer that is broken.
#
# This script does exactly what `gcloud builds submit` does -- tar the source, stage it in
# the Cloud Build bucket, create a build from cloudbuild.yaml -- using curl and the same
# access token. It deliberately reuses cloudbuild.yaml rather than reimplementing the
# deploy, so the canary gate (deploy with --no-traffic, probe /api/health on the tagged
# revision, promote only on success) still applies. A deploy path that skips that gate
# would be the wrong thing to build in a hurry.
#
# Delete this script once gcloud is fixed; it is a workaround, not architecture.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-beaming-crowbar-513808-i4}"
BUCKET="${PROJECT_ID}_cloudbuild"
TS="$(date -u +%Y%m%d-%H%M%S)"
OBJECT="source/stackscore-${TS}.tgz"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

TOK="$(gcloud auth print-access-token)"

echo "==> packaging source"
# --exclude-from with .gcloudignore reproduces what gcloud uploads. Patterns there are
# plain names/globs, which tar's --exclude understands directly.
tar czf "$SCRATCH/source.tgz" \
  --exclude-from=.gcloudignore \
  --exclude=.git \
  --exclude=node_modules \
  .
SIZE=$(stat -c %s "$SCRATCH/source.tgz")
echo "    $(numfmt --to=iec "$SIZE")"

echo "==> staging to gs://${BUCKET}/${OBJECT}"
curl -sS -X POST \
  "https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${OBJECT}" \
  -H "Authorization: Bearer $TOK" \
  -H "Content-Type: application/gzip" \
  --data-binary "@$SCRATCH/source.tgz" \
  -o "$SCRATCH/upload.json"
if ! jq -e '.name' "$SCRATCH/upload.json" >/dev/null; then
  echo "upload failed:"; jq . "$SCRATCH/upload.json"; exit 1
fi

echo "==> building request from cloudbuild.yaml"
# Cloud Build's REST API takes the same fields as the YAML, so the config is converted
# rather than retyped -- the YAML stays the single source of truth for the deploy.
# Substitution defaults live in the YAML and are passed through as-is.
python3 -I - "$SCRATCH/build.json" "$BUCKET" "$OBJECT" <<'PY'
import json, sys, yaml

# Unpack explicitly rather than by slice width: this line silently took the wrong number
# of arguments once already, and the failure surfaced only after the source tarball had
# been built and uploaded.
if len(sys.argv) != 4:
    sys.exit(f"deploy-rest.sh: expected 3 arguments, got {len(sys.argv) - 1}")
out_path, bucket, obj = sys.argv[1:4]
with open("cloudbuild.yaml") as f:
    cfg = yaml.safe_load(f)

build = {
    "source": {"storageSource": {"bucket": bucket, "object": obj}},
    "steps": cfg["steps"],
}
for key in ("images", "options", "timeout", "substitutions", "availableSecrets", "tags"):
    if key in cfg:
        build[key] = cfg[key]

# $PROJECT_ID / $BUILD_ID etc. are resolved by Cloud Build itself, so nothing is
# interpolated here. Only _-prefixed user substitutions can be overridden.
with open(out_path, "w") as f:
    json.dump(build, f)

print(f"    steps: {len(build['steps'])}, substitutions: "
      f"{list(build.get('substitutions', {}))}")
PY

echo "==> submitting build"
curl -sS -X POST \
  "https://cloudbuild.googleapis.com/v1/projects/${PROJECT_ID}/builds" \
  -H "Authorization: Bearer $TOK" \
  -H "Content-Type: application/json" \
  --data-binary "@$SCRATCH/build.json" \
  -o "$SCRATCH/op.json"

if ! jq -e '.metadata.build.id' "$SCRATCH/op.json" >/dev/null 2>&1; then
  echo "submit failed:"; jq . "$SCRATCH/op.json"; exit 1
fi
BUILD_ID=$(jq -r '.metadata.build.id' "$SCRATCH/op.json")
echo "    build: $BUILD_ID"
echo "    logs:  https://console.cloud.google.com/cloud-build/builds/${BUILD_ID}?project=${PROJECT_ID}"

echo "==> waiting"
# Tokens expire in ~1h and a cold build can approach that, so refresh each poll.
while :; do
  sleep 20
  TOK="$(gcloud auth print-access-token)"

  STATUS=$(curl -sS "https://cloudbuild.googleapis.com/v1/projects/${PROJECT_ID}/builds/${BUILD_ID}" \
    -H "Authorization: Bearer $TOK" | jq -r '.status')
  echo "    $STATUS"
  case "$STATUS" in
    SUCCESS) echo "==> build succeeded"; break ;;
    FAILURE|INTERNAL_ERROR|TIMEOUT|CANCELLED|EXPIRED)
      echo "==> build $STATUS"
      echo "    full log:"
      curl -sS "https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/log-${BUILD_ID}.txt?alt=media" \
        -H "Authorization: Bearer $TOK" | tail -60
      exit 1 ;;
  esac
done

echo "==> verifying the live service"
curl -sS https://stackscore.anandrajendran.dev/api/health | jq .
