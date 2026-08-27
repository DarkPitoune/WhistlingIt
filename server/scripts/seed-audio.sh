#!/usr/bin/env bash
# Put the reference clip in the local `songs` bucket, so `npm run dev` against a
# local stack is actually playable.
#
# `supabase db reset` truncates storage.objects along with everything else, so
# re-run this after every reset. Local only — it uses the CLI's fixed demo
# service key, which is the same on every machine.
set -euo pipefail

cd "$(dirname "$0")/.."

CLIP="../client/public/clips/hedwig.wav"
DEST="dev/hedwig.wav"

[ -f "$CLIP" ] || { echo "missing $CLIP — run 'npm run clip' in ../client first" >&2; exit 1; }

eval "$(supabase status -o env | grep -E '^(API_URL|SERVICE_ROLE_KEY)=')"

# Idempotent: DELETE first, since the bucket rejects an upload to a taken path.
curl -fsS -X DELETE "$API_URL/storage/v1/object/songs/$DEST" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" >/dev/null 2>&1 || true

curl -fsS -X POST "$API_URL/storage/v1/object/songs/$DEST" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: audio/wav" \
  --data-binary "@$CLIP" >/dev/null

echo "uploaded $DEST -> $API_URL/storage/v1/object/public/songs/$DEST"
