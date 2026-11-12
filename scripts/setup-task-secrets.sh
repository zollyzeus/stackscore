#!/usr/bin/env bash
# Create TASK_RUNNER_SECRET and REVIEWER_SECRET in Secret Manager over REST and grant the
# Cloud Run runtime identity access. gcloud's HTTP layer is broken on this machine
# (AUDIT_TODO E8), so everything goes through curl with a printed access token.
#
# The secret values are generated here and never printed.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-beaming-crowbar-513808-i4}"
TOK="$(gcloud auth print-access-token)"
API="https://secretmanager.googleapis.com/v1/projects/${PROJECT_ID}"

PROJECT_NUMBER="$(curl -sS "https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT_ID}" \
  -H "Authorization: Bearer $TOK" | python3 -I -c 'import json,sys;print(json.load(sys.stdin)["projectNumber"])')"
# The Cloud Run revision runs as the default compute SA, NOT stackscore-server@ (which is
# FIREBASE_CLIENT_EMAIL and never reads Secret Manager). Granting the wrong one yields
# SECRETS_ACCESS_CHECK_FAILED while the previous revision keeps serving.
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
echo "runtime identity: $SA"

for NAME in TASK_RUNNER_SECRET REVIEWER_SECRET; do
  echo "==> $NAME"

  code=$(curl -sS -o /tmp/mk.out -w '%{http_code}' -X POST \
    "${API}/secrets?secretId=${NAME}" \
    -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
    --data '{"replication":{"automatic":{}}}')
  if [ "$code" = "200" ]; then echo "    created"
  elif [ "$code" = "409" ]; then echo "    already exists"
  else echo "    create failed ($code)"; cat /tmp/mk.out; exit 1; fi

  # A container with zero versions fails Cloud Run startup, so always ensure one exists.
  have=$(curl -sS "${API}/secrets/${NAME}/versions?pageSize=1" \
    -H "Authorization: Bearer $TOK" | python3 -I -c 'import json,sys;print(len(json.load(sys.stdin).get("versions",[])))')
  if [ "$have" = "0" ]; then
    VALUE="$(python3 -I -c 'import secrets;print(secrets.token_urlsafe(48))')"
    PAYLOAD="$(printf '%s' "$VALUE" | base64 -w0)"
    code=$(curl -sS -o /tmp/mk.out -w '%{http_code}' -X POST \
      "${API}/secrets/${NAME}:addVersion" \
      -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
      --data "{\"payload\":{\"data\":\"${PAYLOAD}\"}}")
    unset VALUE PAYLOAD
    [ "$code" = "200" ] && echo "    version added" || { echo "    addVersion failed ($code)"; cat /tmp/mk.out; exit 1; }
  else
    echo "    version already present"
  fi

  # Merge the binding rather than overwrite the policy: setIamPolicy replaces it wholesale,
  # so a blind write would drop any grant already there.
  curl -sS "${API}/secrets/${NAME}:getIamPolicy" -H "Authorization: Bearer $TOK" > /tmp/pol.json
  python3 -I - "$SA" <<'PY' > /tmp/newpol.json
import json, sys
sa = sys.argv[1]
pol = json.load(open("/tmp/pol.json"))
pol.pop("etag", None) if False else None
bindings = pol.get("bindings", [])
role = "roles/secretmanager.secretAccessor"
member = f"serviceAccount:{sa}"
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
  code=$(curl -sS -o /tmp/mk.out -w '%{http_code}' -X POST \
    "${API}/secrets/${NAME}:setIamPolicy" \
    -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
    --data-binary @/tmp/newpol.json)
  [ "$code" = "200" ] && echo "    accessor granted" || { echo "    setIamPolicy failed ($code)"; cat /tmp/mk.out; exit 1; }
done

rm -f /tmp/mk.out /tmp/pol.json /tmp/newpol.json
echo "done"
