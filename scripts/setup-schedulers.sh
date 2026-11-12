#!/usr/bin/env bash
#
# Create the Cloud Scheduler jobs that drive the background workers (A3 + B5).
#
#   bash scripts/setup-task-secrets.sh    # first: TASK_RUNNER_SECRET must exist
#   bash scripts/deploy-rest.sh           # then: deploy so the service can read it
#   bash scripts/setup-schedulers.sh      # finally: wire the schedules
#
# Ordering matters. Every worker endpoint fails CLOSED when TASK_RUNNER_SECRET is absent,
# so schedulers created before the secret exists will run and 401 every time until the
# deploy that picks it up. That is a safe failure, but a noisy one.
#
# Uses the Cloud Scheduler REST API because gcloud's HTTP layer is broken on this machine
# (AUDIT_TODO E8). The secret value is read from Secret Manager and never printed.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-beaming-crowbar-513808-i4}"
REGION="${REGION:-us-central1}"
SERVICE_URL="${SERVICE_URL:-https://stackscore.anandrajendran.dev}"

TOK="$(gcloud auth print-access-token)"
API="https://cloudscheduler.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/jobs"

echo "==> reading TASK_RUNNER_SECRET"
SECRET="$(curl -sS \
  "https://secretmanager.googleapis.com/v1/projects/${PROJECT_ID}/secrets/TASK_RUNNER_SECRET/versions/latest:access" \
  -H "Authorization: Bearer $TOK" \
  | python3 -I -c 'import json,sys,base64;print(base64.b64decode(json.load(sys.stdin)["payload"]["data"]).decode())')"
if [ -z "$SECRET" ]; then
  echo "TASK_RUNNER_SECRET not found. Run scripts/setup-task-secrets.sh first." >&2
  exit 1
fi

# name | cron | path | description
#
# Cadences, and why:
#   calibration-monitor  DAILY, 06:00 UTC. Three real judge calls, ~$0.40 a run, ~$12/month.
#                        Hourly (~$290/month) buys detection-within-the-hour of the D8
#                        failure class -- a judge that has silently stopped working -- which
#                        is not worth 24x the cost before there is continuous real traffic.
#                        Daily still catches a persistent regression and the rubric
#                        fingerprint drift; what it concedes is that a scoring outage could
#                        run most of a day unnoticed. Revisit when candidates are being
#                        assessed continuously: re-running this script PATCHes the schedule
#                        in place, so raising it is a one-line change and one command.
#   rejudge              every 15 min. A partial score is a candidate waiting on a real one,
#                        so latency matters here in a way it does not for the monitor. The
#                        queue is almost always empty and an empty run costs nothing.
#   drain-pending        every 10 min. Only does anything in the window just after a hold
#                        lifts, and refuses to run while one is active. Also free when idle.
JOBS=$(cat <<'EOF'
calibration-monitor|0 6 * * *|/api/tasks/calibration-monitor|Daily judge rule-compliance probe (B5)
rejudge-partials|*/15 * * * *|/api/tasks/rejudge|Re-judge scores the calibrated judge failed (A3)
drain-pending-scoring|*/10 * * * *|/api/tasks/drain-pending|Score submissions queued during a hold (B5)
EOF
)

FAILED=0

while IFS='|' read -r NAME CRON PATHNAME DESC; do
  [ -z "$NAME" ] && continue
  echo "==> $NAME ($CRON)"

  # Cloud Scheduler requires the fully-qualified resource path in `name`, not a bare job id.
  FQN="projects/${PROJECT_ID}/locations/${REGION}/jobs/${NAME}"

  BODY=$(python3 -I - "$FQN" "$CRON" "${SERVICE_URL}${PATHNAME}" "$SECRET" "$DESC" <<'PY'
import json, sys
name, cron, url, secret, desc = sys.argv[1:6]
print(json.dumps({
    "name": name,
    "description": desc,
    "schedule": cron,
    "timeZone": "UTC",
    # Retries are conservative: these workers are idempotent per task, but a storm of
    # retries against a failing judge spends money without improving anything.
    "retryConfig": {"retryCount": 2, "minBackoffDuration": "30s"},
    "attemptDeadline": "320s",
    "httpTarget": {
        "uri": url,
        "httpMethod": "POST",
        "headers": {"Authorization": f"Bearer {secret}"},
    },
}))
PY
)

  code=$(curl -sS -o /tmp/sched.out -w '%{http_code}' -X POST "$API" \
    -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
    --data-binary "$BODY")

  if [ "$code" = "200" ]; then
    echo "    created"
  elif [ "$code" = "409" ]; then
    # Already there: PATCH it so re-running this script updates the schedule in place
    # rather than failing and leaving an old cadence behind.
    code=$(curl -sS -o /tmp/sched.out -w '%{http_code}' -X PATCH \
      "${API}/${NAME}?updateMask=schedule,httpTarget,retryConfig,description" \
      -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
      --data-binary "$BODY")
    [ "$code" = "200" ] && echo "    updated" || { echo "    update failed ($code)"; cat /tmp/sched.out; FAILED=1; }
  else
    echo "    failed ($code)"; cat /tmp/sched.out; FAILED=1
  fi
done <<< "$JOBS"

unset SECRET
rm -f /tmp/sched.out
echo

# Report what actually happened. An earlier version of this script printed "Jobs created"
# unconditionally and said so even when every call had failed with a disabled-API error --
# the same false-success pattern that let a broken deploy and a non-functional judge each
# look fine. A setup script that cannot fail is not reporting, it is decorating.
if [ "$FAILED" -ne 0 ]; then
  echo "One or more jobs were NOT created. Nothing is scheduled; fix the errors above and re-run." >&2
  exit 1
fi

echo "All jobs created. Verify with:"
echo "  curl -sS '${API}' -H \"Authorization: Bearer \$(gcloud auth print-access-token)\" | python3 -m json.tool"
