#!/bin/bash
set -euo pipefail

BACKEND_URL="${BACKEND_URL:-http://localhost:3000}"
MONGO_CONTAINER="${MONGO_CONTAINER:-docker-atlas_local-1}"
RESET_MODE="${RESET_MODE:-fast}" # fast|full|none

EMBED_LIMIT="${EMBED_LIMIT:-100}"
EMBED_MAX_ITERS="${EMBED_MAX_ITERS:-200}"

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

say "Running 2 representative /search/ask queries."
run_ask() {
  local q="$1"
  say "ASK: $q"
  local body
  body="$(curl -fsS -G "$BACKEND_URL/search/ask" --data-urlencode "q=$q")"
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

say "Smoke loop finished successfully."

