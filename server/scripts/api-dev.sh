#!/usr/bin/env bash
# Run the ingest API against the local Supabase stack, reachable from `npm run dev`.
#
# The keys come from `supabase status`, so this never hardcodes them, and CORS is
# opened to Vite's origin — without ALLOWED_ORIGINS the API falls back to "*",
# which is fine locally and wrong in production.
set -euo pipefail

cd "$(dirname "$0")/.."

[ -x api/.venv/bin/uvicorn ] || {
  echo "no api/.venv — see api/README.md for the two uv commands" >&2; exit 1; }

eval "$(supabase status -o env | grep -E '^(API_URL|SERVICE_ROLE_KEY)=')"

export SUPABASE_URL="$API_URL"
export SUPABASE_SERVICE_KEY="$SERVICE_ROLE_KEY"
export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-http://localhost:5173,http://127.0.0.1:5173}"

echo "ingest API -> $SUPABASE_URL   cors: $ALLOWED_ORIGINS"
cd api
exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
