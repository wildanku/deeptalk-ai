#!/usr/bin/env bash
# Local Teman AI stack in one command: agent + gateway (deeptalk-ai), deeptalk-api-v3 (AI branch),
# deeptalk-web-v2, psikolog-deeptalk-dashboard. psikolog-service is the deployed one (see v3 .env).
#
#   ./scripts/dev-stack.sh up        # start whatever is not running yet, then wait for health
#   ./scripts/dev-stack.sh down      # stop everything this script started
#   ./scripts/dev-stack.sh status    # port + health per service
#   ./scripts/dev-stack.sh logs [svc]   # tail logs (agent|gateway|v3|web|dashboard)
#
# Prerequisites: Postgres + Redis running locally; .env in agent/, gateway/, deeptalk-api-v3/,
# deeptalk-web-v2/, psikolog-deeptalk-dashboard/ (see docs/tasks/20261015-uji-lokal-alur-psikolog.md).
# v3 runs from a build of $V3_BRANCH under .dev/v3-ai (rebuilt when the branch moves), so the
# v3 checkout itself is never switched. Env: V3_DIR, V3_BRANCH.
set -euo pipefail

AI="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$AI/.." && pwd)"
STATE="$AI/.dev"
LOGS="$STATE/logs"
V3_DIR="${V3_DIR:-$ROOT/deeptalk-api-v3}"
V3_BRANCH="${V3_BRANCH:-feat/ai-phase-1}"
V3_BUILD="$STATE/v3-ai"
WEB="$ROOT/deeptalk-web-v2"
DASH="$ROOT/psikolog-deeptalk-dashboard"
SERVICES=(agent v3 gateway web dashboard)

port_of() { case "$1" in agent) echo 8000 ;; gateway) echo 8080 ;; v3) echo 3100 ;; web) echo 3000 ;; dashboard) echo 3001 ;; esac; }
health_of() {
  case "$1" in
    agent) echo "http://localhost:8000/health" ;;
    gateway) echo "http://localhost:8080/v1/health" ;;
    v3) echo "http://localhost:3100/v2/.well-known/ai-jwks.json" ;;
    web) echo "http://localhost:3000/" ;;
    dashboard) echo "http://localhost:3001/login" ;;
  esac
}
# `|| true`: lsof exits 1 for a free port, which would abort assignments under pipefail.
listening() { lsof -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -1 || true; }
healthy() {
  local code
  code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$(health_of "$1")" || true)
  [[ "$code" =~ ^(200|307|308)$ ]]
}

require() {
  local missing=0
  pg_isready -q || { echo "✗ Postgres lokal tidak jalan"; missing=1; }
  [ "$(redis-cli ping 2>/dev/null)" = "PONG" ] || { echo "✗ Redis lokal tidak jalan"; missing=1; }
  for f in "$AI/agent/.env" "$AI/gateway/.env" "$V3_DIR/.env" "$WEB/.env" "$DASH/.env"; do
    [ -f "$f" ] || { echo "✗ belum ada: $f"; missing=1; }
  done
  if grep -q "^SUPERADMIN_LOGOS_CLIENT=ISI_SENDIRI" "$V3_DIR/.env" 2>/dev/null; then
    echo "! SUPERADMIN_LOGOS_* di $V3_DIR/.env belum diisi: login psikolog ke Teman AI akan gagal"
  fi
  [ "$missing" = 0 ] || exit 1
}

build_v3() {
  local sha
  sha=$(git -C "$V3_DIR" rev-parse "$V3_BRANCH")
  if [ -f "$V3_BUILD/dist/main.js" ] && [ "$(cat "$V3_BUILD/.built-sha" 2>/dev/null)" = "$sha" ]; then return; fi
  echo "… build v3 $V3_BRANCH (${sha:0:7}) ke .dev/v3-ai"
  rm -rf "$V3_BUILD" && mkdir -p "$V3_BUILD"
  git -C "$V3_DIR" archive "$V3_BRANCH" | tar -x -C "$V3_BUILD"
  ln -s "$V3_DIR/node_modules" "$V3_BUILD/node_modules"
  ln -s "$V3_DIR/.env" "$V3_BUILD/.env"
  (cd "$V3_BUILD" && ./node_modules/.bin/prisma generate >/dev/null \
    && rm -f ./*.tsbuildinfo && ./node_modules/.bin/nest build >"$LOGS/v3-build.log" 2>&1) \
    || { echo "✗ build v3 gagal, lihat $LOGS/v3-build.log"; exit 1; }
  echo "$sha" >"$V3_BUILD/.built-sha"
}

launch() {
  local svc="$1" dir="$2"
  shift 2
  if [ -n "$(listening "$(port_of "$svc")")" ]; then
    echo "• $svc sudah jalan di :$(port_of "$svc")"
    return
  fi
  # cd first, then background nohup itself: $! is then the service (not an intermediate shell that
  # would keep this script's stdout open), and no stdio stays attached to the caller.
  (
    cd "$dir" || exit 1
    nohup "$@" >"$LOGS/$svc.log" 2>&1 </dev/null &
    echo $! >"$STATE/$svc.pid"
  )
  echo "▶ $svc → :$(port_of "$svc")  (log: .dev/logs/$svc.log)"
}

wait_healthy() {
  local svc="$1" timeout="${2:-120}"
  for _ in $(seq 1 "$timeout"); do
    healthy "$svc" && { echo "✓ $svc sehat"; return 0; }
    sleep 1
  done
  echo "✗ $svc belum sehat setelah ${timeout} dtk — tail .dev/logs/$svc.log:"
  tail -15 "$LOGS/$svc.log" | sed 's/^/    /'
  return 1
}

up() {
  mkdir -p "$LOGS"
  require
  build_v3
  local agent_cmd=(env -u VIRTUAL_ENV .venv/bin/uvicorn app.main:app --port 8000 --reload)
  command -v uv >/dev/null && agent_cmd=(uv run uvicorn app.main:app --port 8000 --reload)
  launch agent "$AI/agent" "${agent_cmd[@]}"
  launch v3 "$V3_BUILD" node dist/main
  launch gateway "$AI/gateway" pnpm run start:dev
  launch web "$WEB" pnpm exec next dev -p 3000
  launch dashboard "$DASH" pnpm exec next dev -p 3001
  local failed=0
  for svc in "${SERVICES[@]}"; do wait_healthy "$svc" 180 || failed=1; done
  echo
  status
  [ "$failed" = 0 ]
}

# Watchers (pnpm → nest --watch, next dev, uvicorn --reload) run the listener as a descendant, so
# stop the whole tree; killing only the listener would leave the watcher to respawn it.
kill_tree() {
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do kill_tree "$child"; done
  kill "$1" 2>/dev/null || true
}

stop_svc() {
  local svc="$1" pid port
  port=$(port_of "$svc")
  if [ -f "$STATE/$svc.pid" ]; then
    kill_tree "$(cat "$STATE/$svc.pid")"
    rm -f "$STATE/$svc.pid"
  fi
  for _ in 1 2 3 4 5; do [ -z "$(listening "$port")" ] && break; sleep 1; done
  pid=$(listening "$port")
  if [ -n "$pid" ]; then kill_tree "$pid"; fi
  echo "■ $svc dihentikan"
}

down() { for svc in "${SERVICES[@]}"; do stop_svc "$svc"; done; }

status() {
  printf '%-10s %-6s %-6s %s\n' LAYANAN PORT STATUS URL
  for svc in "${SERVICES[@]}"; do
    local port s
    port=$(port_of "$svc")
    if [ -z "$(listening "$port")" ]; then s="mati"; elif healthy "$svc"; then s="sehat"; else s="start"; fi
    printf '%-10s %-6s %-6s %s\n' "$svc" "$port" "$s" "http://localhost:$port"
  done
}

logs() {
  if [ -n "${1:-}" ]; then tail -f "$LOGS/$1.log"; else tail -f "$LOGS"/{agent,v3,gateway,web,dashboard}.log; fi
}

case "${1:-up}" in
  up) up ;;
  down) down ;;
  restart) down; sleep 1; up ;;
  status) status ;;
  logs) logs "${2:-}" ;;
  *) echo "pakai: $0 up|down|restart|status|logs [layanan]" >&2; exit 2 ;;
esac
