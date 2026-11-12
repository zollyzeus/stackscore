#!/usr/bin/env bash
#
# Exercises the compute-version logic from cloudbuild.yaml against mocked tag listings.
#
#   bash scripts/test-compute-version.sh
#
# This exists because the step it covers shipped a wrong version string to production twice
# (AUDIT_TODO E9) and there is no cheap way to test it in situ -- a Cloud Build run is five
# minutes and a container push.
#
# The case that matters most is "version tag and :latest on the same image". gcloud's get()
# formatter joins multiple values with a SEMICOLON, so that image comes back as the single
# field "261112002;latest". That is what produced version 000, and no test covered it.

compute() {
  local TODAY="$1" RAW="$2"
  (
    set -eu
    EXISTING=$(printf '%s\n' "$RAW" | tr ',;' '\n\n' | grep "^$TODAY" | sort -n | tail -1 || true)
    if [ -z "$EXISTING" ]; then
      SEQ=1
    else
      SUFFIX=${EXISTING#$TODAY}
      case "$SUFFIX" in
        [0-9][0-9][0-9]) ;;
        *) echo "ERR unparseable '$EXISTING'" >&2; exit 1 ;;
      esac
      SEQ=$(( 10#$SUFFIX + 1 ))
    fi
    if [ -z "${SEQ:-}" ] || [ "$SEQ" -lt 1 ] || [ "$SEQ" -gt 999 ]; then
      echo "ERR seq out of range '${SEQ:-<empty>}'" >&2; exit 1
    fi
    printf '%s%03d\n' "$TODAY" "$SEQ"
  )
}

fail=0
check() {
  if [ "$2" = "$3" ]; then echo "  ok   $1 -> $3"
  else echo "  FAIL $1: expected $2 got $3"; fail=1; fi
}
expect_err() {
  case "$2" in ERR*) echo "  ok   $1 rejected";; *) echo "  FAIL $1 gave '$2'"; fail=1;; esac
}

echo "compute-version logic:"

# The regression. gcloud emits ';' between tags on one image; ',' never appears.
check "version tag sharing an image with :latest" \
  "261112003" "$(compute 261112 '261112000
261112001
261112002;latest' 2>&1)"
check ":latest on an older image" \
  "261112002" "$(compute 261112 '261112000;latest
261112001' 2>&1)"

check "no tags today"          "261112001" "$(compute 261112 'latest
261111004' 2>&1)"
check "one tag today"          "261112002" "$(compute 261112 '261112001' 2>&1)"
check "the buggy 000 tag only" "261112001" "$(compute 261112 '261112000' 2>&1)"
check "000 and 001 present"    "261112002" "$(compute 261112 '261112000
261112001' 2>&1)"
check "unsorted input"         "261112011" "$(compute 261112 '261112010
261112002
261112009' 2>&1)"
check "empty listing"          "261112001" "$(compute 261112 '' 2>&1)"
check "comma separator too"    "261112003" "$(compute 261112 '261112002,latest' 2>&1)"

# A suffix this scheme cannot parse must stop the deploy rather than render as 000.
expect_err "malformed suffix"    "$(compute 261112 '261112abc' 2>&1 || true)"
expect_err "sequence overflow"   "$(compute 261112 '261112999' 2>&1 || true)"

[ "$fail" = 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
