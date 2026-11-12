#!/usr/bin/env bash
#
# Create TASK_RUNNER_SECRET and REVIEWER_SECRET in Secret Manager and grant the Cloud Run
# runtime identity read access.
#
#   bash scripts/setup-task-secrets.sh
#
# Idempotent: safe to re-run. An existing secret is left alone, and an existing version is
# never replaced -- rotating a value is a separate, deliberate act, not a side effect of
# re-running setup.
#
# Everything goes through the REST API because gcloud's HTTP layer is broken on this
# machine (AUDIT_TODO E8).
#
# Secret handling: values are generated locally, written only to a 0600 file inside a
# private temp directory, and passed to curl with --data-binary @file rather than on the
# command line -- an argv is world-readable through /proc while the process runs. Nothing
# is ever echoed.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-beaming-crowbar-513808-i4}"
API="https://secretmanager.googleapis.com/v1/projects/${PROJECT_ID}"

WORK="$(mktemp -d)"
chmod 700 "$WORK"
# Shred rather than unlink: the request body file holds the secret in base64.
trap 'find "$WORK" -type f -exec shred -u {} + 2>/dev/null || true; rm -rf "$WORK"' EXIT

TOK="$(gcloud auth print-access-token)"

PROJECT_NUMBER="$(curl -sS "https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT_ID}" \
  -H "Authorization: Bearer $TOK" \
  | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["projectNumber"])')"

# The Cloud Run revision runs as the DEFAULT COMPUTE SA, not stackscore-server@ (which is
# FIREBASE_CLIENT_EMAIL and never reads Secret Manager). Granting the wrong principal
# produces SECRETS_ACCESS_CHECK_FAILED on the new revision while the old one keeps serving,
# so the deploy looks successful and the change silently does not take effect.
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
echo "runtime identity: $SA"

for NAME in TASK_RUNNER_SECRET REVIEWER_SECRET; do
  echo "==> $NAME"

  code=$(curl -sS -o "$WORK/out" -w '%{http_code}' -X POST \
    "${API}/secrets?secretId=${NAME}" \
    -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
    --data '{"replication":{"automatic":{}}}')
  case "$code" in
    200) echo "    container created" ;;
    409) echo "    container already exists" ;;
    *)   echo "    create failed ($code)"; cat "$WORK/out"; exit 1 ;;
  esac

  # A secret container with ZERO versions fails Cloud Run startup when it is referenced by
  # --set-secrets, so the container existing is not enough -- it must hold a version.
  have=$(curl -sS "${API}/secrets/${NAME}/versions?pageSize=1" \
    -H "Authorization: Bearer $TOK" \
    | python3 -I -c 'import json,sys;print(len(json.load(sys.stdin).get("versions",[])))')

  if [ "$have" = "0" ]; then
    umask 077
    python3 -I -c 'import secrets,base64,json,sys
v = secrets.token_urlsafe(48)
sys.stdout.write(json.dumps({"payload": {"data": base64.b64encode(v.encode()).decode()}}))' \
      > "$WORK/body.json"
    code=$(curl -sS -o "$WORK/out" -w '%{http_code}' -X POST \
      "${API}/secrets/${NAME}:addVersion" \
      -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
      --data-binary "@$WORK/body.json")
    shred -u "$WORK/body.json" 2>/dev/null || rm -f "$WORK/body.json"
    [ "$code" = "200" ] \
      && echo "    version added" \
      || { echo "    addVersion failed ($code)"; cat "$WORK/out"; exit 1; }
  else
    echo "    version already present (left unchanged)"
  fi

  # setIamPolicy REPLACES the policy wholesale, so the existing one is read and the binding
  # merged into it. A blind write would silently drop any other grant already there.
  # The etag is kept deliberately: it makes the write fail rather than clobber if the policy
  # changed between the read and the write.
  code=$(curl -sS -o "$WORK/pol.json" -w '%{http_code}' \
    "${API}/secrets/${NAME}:getIamPolicy" -H "Authorization: Bearer $TOK")
  [ "$code" = "200" ] || { echo "    getIamPolicy failed ($code)"; cat "$WORK/pol.json"; exit 1; }

  python3 -I - "$SA" "$WORK/pol.json" > "$WORK/newpol.json" <<'PY'
import json, sys

sa, pol_path = sys.argv[1], sys.argv[2]
pol = json.load(open(pol_path))
role = "roles/secretmanager.secretAccessor"
member = f"serviceAccount:{sa}"

bindings = pol.get("bindings", [])
for b in bindings:
    if b.get("role") == role:
        if member not in b.get("members", []):
            b.setdefault("members", []).append(member)
        break
else:
    bindings.append({"role": role, "members": [member]})
pol["bindings"] = bindings
print(json.dumps({"policy": pol}))
PY

  code=$(curl -sS -o "$WORK/out" -w '%{http_code}' -X POST \
    "${API}/secrets/${NAME}:setIamPolicy" \
    -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
    --data-binary "@$WORK/newpol.json")
  [ "$code" = "200" ] \
    && echo "    accessor granted to $SA" \
    || { echo "    setIamPolicy failed ($code)"; cat "$WORK/out"; exit 1; }
done

echo
echo "done. Next:"
echo "  bash scripts/deploy-rest.sh        # picks the secrets up via the optional-secret loop"
echo "  bash scripts/setup-schedulers.sh   # wires the hourly/periodic jobs"
