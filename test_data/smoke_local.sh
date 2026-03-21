#!/bin/bash
set -euo pipefail

BACKEND_URL="${BACKEND_URL:-http://localhost:3000}"
MONGO_CONTAINER="${MONGO_CONTAINER:-docker-atlas_local-1}"
RESET_MODE="${RESET_MODE:-fast}" # fast|full|none

EMBED_LIMIT="${EMBED_LIMIT:-100}"
EMBED_MAX_ITERS="${EMBED_MAX_ITERS:-200}"

# Stable smoke-test identity: fixed UUID so session list is deterministic.
SMOKE_CLIENT_ID="${SMOKE_CLIENT_ID:-smoke-client-00000000-0000-0000-0000-000000000001}"
SMOKE_SESSION_ID="smoke-sess-$(date +%s)"

DATA_DIR="$(cd "$(dirname "$0")" && pwd)"

say() { echo "[smoke] $*"; }
die() { echo "[smoke][ERROR] $*" 1>&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

require_cmd docker
require_cmd curl
require_cmd node

say "Backend URL: $BACKEND_URL"
say "Mongo container: $MONGO_CONTAINER"
say "Reset mode: $RESET_MODE"
say "Smoke client ID: $SMOKE_CLIENT_ID"
say "Smoke session ID: $SMOKE_SESSION_ID"

say "Checking backend health."
if ! curl -fsS "$BACKEND_URL/" >/dev/null; then
  die "backend is not reachable at $BACKEND_URL/ (start backend first, then re-run)"
fi

if [[ "$RESET_MODE" == "full" ]]; then
  say "Full reset requested: docker compose down -v && up -d --build"
  docker compose -f docker/docker-compose.yml down -v
  docker compose -f docker/docker-compose.yml up -d --build
elif [[ "$RESET_MODE" == "fast" ]]; then
  say "Fast reset requested: dropping embedding-related collections and re-running init."
  docker exec -i "$MONGO_CONTAINER" mongosh -u admin -p admin --authenticationDatabase admin --quiet --eval '
    const dbWide = db.getSiblingDB("wide_events");
    ["wide_events_embedded","embedding_progress","chat_history"].forEach((c)=>{
      if(dbWide.getCollectionNames().indexOf(c)!==-1){
        print("[smoke][mongo] dropping: " + c);
        dbWide.getCollection(c).drop();
      } else {
        print("[smoke][mongo] skip drop (missing): " + c);
      }
    });
  '
  docker exec -i "$MONGO_CONTAINER" mongosh -u admin -p admin --authenticationDatabase admin --quiet --file /docker-entrypoint-initdb.d/mongodb-init.js
elif [[ "$RESET_MODE" == "none" ]]; then
  say "Reset skipped."
else
  die "unknown RESET_MODE='$RESET_MODE' (expected: fast|full|none)"
fi

say "Generating payments dataset."
(cd "$DATA_DIR" && node generator.js)

say "Loading traffic to /payments."
(cd "$DATA_DIR" && bash run_load_test.sh)

say "Running embedding batch loop until processedCount==0."
iters=0
totalProcessed=0
while true; do
  iters=$((iters+1))
  if [[ "$iters" -gt "$EMBED_MAX_ITERS" ]]; then
    die "embedding loop exceeded EMBED_MAX_ITERS=$EMBED_MAX_ITERS (last totalProcessed=$totalProcessed)"
  fi

  resp="$(curl -fsS -X POST "$BACKEND_URL/embeddings/batch?limit=$EMBED_LIMIT")"
  processed="$(node -e 'const fs=require("fs"); const x=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(String(x.processedCount ?? "0"));' <<<"$resp")"
  if ! [[ "$processed" =~ ^[0-9]+$ ]]; then
    echo "$resp" 1>&2
    die "unexpected /embeddings/batch response (processedCount not numeric)"
  fi

  totalProcessed=$((totalProcessed + processed))
  say "batch #$iters processedCount=$processed (total=$totalProcessed)"

  if [[ "$processed" -eq 0 ]]; then
    break
  fi
done

# ---------------------------------------------------------------------------
# Phase 5 search/ask smoke queries
# Sends X-Client-Id and sessionId so that chat_history documents are stored
# with clientId, enabling session list and delete verification below.
# ---------------------------------------------------------------------------
say "Running 2 representative /search/ask queries (session=$SMOKE_SESSION_ID, client=$SMOKE_CLIENT_ID)."
run_ask() {
  local q="$1"
  say "ASK: $q"
  local body
  body="$(curl -fsS -G "$BACKEND_URL/search/ask" \
    -H "X-Client-Id: $SMOKE_CLIENT_ID" \
    --data-urlencode "q=$q" \
    --data-urlencode "sessionId=$SMOKE_SESSION_ID")"
  local sourcesLen
  sourcesLen="$(node -e 'const fs=require("fs"); const x=JSON.parse(fs.readFileSync(0,"utf8")); const s=x.sources; process.stdout.write(String(Array.isArray(s)?s.length:0));' <<<"$body")"
  say "sources.length=$sourcesLen"
  echo "$body" | node -e '
    const fs=require("fs");
    const x=JSON.parse(fs.readFileSync(0,"utf8"));
    const answer = x.answer || x.message || x.error || "(no answer field)";
    process.stdout.write(String(answer).slice(0, 400) + (String(answer).length>400 ? "..." : "") + "\n");
  '
}

run_ask "오류가 발생한 적이 있어?"
run_ask "결제 게이트웨이 오류가 왜 났어?"

# ---------------------------------------------------------------------------
# Phase 5.2 session API verification
# ---------------------------------------------------------------------------
say "Verifying GET /search/sessions returns at least 1 session for smoke client."
sessions_body="$(curl -fsS "$BACKEND_URL/search/sessions" \
  -H "X-Client-Id: $SMOKE_CLIENT_ID")"

session_count="$(node -e '
  const fs=require("fs");
  const x=JSON.parse(fs.readFileSync(0,"utf8"));
  process.stdout.write(String(Array.isArray(x) ? x.length : -1));
' <<<"$sessions_body")"

if [[ "$session_count" == "-1" ]]; then
  echo "$sessions_body" 1>&2
  die "GET /search/sessions did not return an array"
fi
say "sessions count=$session_count"
if [[ "$session_count" -lt 1 ]]; then
  die "expected at least 1 session for client $SMOKE_CLIENT_ID, got $session_count"
fi

say "Verifying GET /search/sessions returns the smoke session with correct title."
node -e '
  const fs=require("fs");
  const sessions=JSON.parse(fs.readFileSync(0,"utf8"));
  const smokeId=process.env.SMOKE_SESSION_ID;
  const found=sessions.find(s=>s.sessionId===smokeId);
  if(!found){ process.stderr.write("[smoke][ERROR] smoke sessionId not found in session list\n"); process.exit(1); }
  process.stdout.write("[smoke] session found: title=\"" + found.title + "\" messages=" + found.messageCount + "\n");
' <<<"$sessions_body"

say "Verifying DELETE /search/sessions/:id removes the smoke session."
delete_body="$(curl -fsS -X DELETE \
  "$BACKEND_URL/search/sessions/$SMOKE_SESSION_ID" \
  -H "X-Client-Id: $SMOKE_CLIENT_ID")"

deleted="$(node -e '
  const fs=require("fs");
  const x=JSON.parse(fs.readFileSync(0,"utf8"));
  process.stdout.write(String(x.deleted === true ? "true" : "false"));
' <<<"$delete_body")"

if [[ "$deleted" != "true" ]]; then
  echo "$delete_body" 1>&2
  die "DELETE /search/sessions/$SMOKE_SESSION_ID did not return {deleted:true}"
fi
say "Session deleted: deleted=$deleted"

say "Verifying session is gone from GET /search/sessions after delete."
sessions_after="$(curl -fsS "$BACKEND_URL/search/sessions" \
  -H "X-Client-Id: $SMOKE_CLIENT_ID")"

node -e '
  const fs=require("fs");
  const sessions=JSON.parse(fs.readFileSync(0,"utf8"));
  const smokeId=process.env.SMOKE_SESSION_ID;
  const found=sessions.find(s=>s.sessionId===smokeId);
  if(found){ process.stderr.write("[smoke][ERROR] smoke session still present after delete\n"); process.exit(1); }
  process.stdout.write("[smoke] session correctly absent after delete (remaining=" + sessions.length + ")\n");
' <<<"$sessions_after"

say "Smoke loop finished successfully."

