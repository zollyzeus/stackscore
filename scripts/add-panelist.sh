#!/usr/bin/env bash
# Usage: ./scripts/add-panelist.sh email@example.com [invitedBy]
# Adds a panelist directly to Firestore — no redeploy needed.

set -e

EMAIL="${1:?Usage: $0 email@example.com [invitedBy]}"
INVITED_BY="${2:-cli}"
PROJECT="beaming-crowbar-513808-i4"
NORMALIZED=$(echo "$EMAIL" | tr '[:upper:]' '[:lower:]' | xargs)
TOKEN=$(gcloud auth print-access-token)
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

curl -s -X PATCH \
  "https://firestore.googleapis.com/v1/projects/$PROJECT/databases/(default)/documents/panelists/$NORMALIZED?updateMask.fieldPaths=active&updateMask.fieldPaths=addedAt&updateMask.fieldPaths=invitedBy" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"fields\": {
      \"active\":    {\"booleanValue\": true},
      \"addedAt\":   {\"stringValue\": \"$NOW\"},
      \"invitedBy\": {\"stringValue\": \"$INVITED_BY\"}
    }
  }" | grep -q '"name"' && echo "✓ $NORMALIZED added as panelist (invitedBy: $INVITED_BY)" || echo "✗ Failed — check token/project"
