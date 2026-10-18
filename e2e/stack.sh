#!/usr/bin/env bash
# Local stack for the E2E scenarios: fake v3 (real AiTokenService from a v3 build), the agent
# with the local model, and two gateway instances sharing Postgres and Redis.
#
#   ./stack.sh up | down | agent | stop-agent | gateways
#
# Env: V3_DIR (deeptalk-api-v3 checkout, built), E2E_DATABASE_URL (a local, disposable
# database with migrations applied), REDIS_URL (default redis://localhost:6379/15),
# GW_EXTRA (extra gateway env, e.g. "SESSION_IDLE_TIMEOUT_SECONDS=8").
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
export E2E_STATE="${E2E_STATE:-$HERE/.state}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379/15}"
: "${E2E_DATABASE_URL:?set E2E_DATABASE_URL to a local, disposable database}"
mkdir -p "$E2E_STATE"

wait_for() { for _ in $(seq 1 60); do curl -s -o /dev/null -w '%{http_code}' "$1" | grep -q 200 && return 0; sleep 0.5; done; echo "timeout: $1" >&2; return 1; }
stop_port() { local pid; pid="$(lsof -ti "tcp:$1" -sTCP:LISTEN || true)"; [ -n "$pid" ] && kill $pid || true; }

secrets() {
  for name in svc inbound scheduler tasks; do [ -s "$E2E_STATE/$name" ] || openssl rand -hex 24 > "$E2E_STATE/$name"; done
  [ -s "$E2E_STATE/msgkey" ] || openssl rand -base64 32 > "$E2E_STATE/msgkey"
}

agent() {
  stop_port 8000
  (cd "$ROOT/agent" && env -u VIRTUAL_ENV APP_ENV=development GOOGLE_CLOUD_PROJECT=e2e-local MODEL_PROVIDER=local LOCAL_MODEL_TOKEN_DELAY_MS=60 \
    .venv/bin/uvicorn app.main:app --port 8000 >> "$E2E_STATE/agent.log" 2>&1 &)
  wait_for http://localhost:8000/health
}

gateways() {
  stop_port 18081; stop_port 18082; sleep 1
  for port in 18081 18082; do
    (cd "$ROOT/gateway" && env NODE_ENV=test PORT=$port LOG_LEVEL=info \
      DATABASE_URL="$E2E_DATABASE_URL" REDIS_URL="$REDIS_URL" REDIS_PREFIX=e2e TASKS_DRIVER=local TASKS_TOKEN="$(cat "$E2E_STATE/tasks")" \
      AI_JWKS_URL=http://localhost:18300/v2/.well-known/ai-jwks.json AGENT_URL=http://localhost:8000 \
      MESSAGE_LOCAL_KEY="$(cat "$E2E_STATE/msgkey")" DEEPTALK_API_URL=http://localhost:18300 \
      AI_SERVICE_TOKEN="$(cat "$E2E_STATE/svc")" INBOUND_WEBHOOK_TOKEN="$(cat "$E2E_STATE/inbound")" \
      SCHEDULER_TOKEN="$(cat "$E2E_STATE/scheduler")" CONTENT_ALLOW_DRAFT=true SESSION_QUOTA_PER_MONTH=2 \
      SESSION_IDLE_TIMEOUT_SECONDS=20 CONTENT_CACHE_SECONDS=1 ACCOUNT_SYNC_INTERVAL_SECONDS=4 \
      ${GW_EXTRA:-} node dist/main >> "$E2E_STATE/gateway-$port.log" 2>&1 &)
  done
  wait_for http://localhost:18081/v1/health && wait_for http://localhost:18082/v1/health
}

up() {
  : "${V3_DIR:?set V3_DIR to a built deeptalk-api-v3 checkout}"
  secrets
  stop_port 18300
  (node "$HERE/fake-v3.js" "$V3_DIR" "$(cat "$E2E_STATE/svc")" >> "$E2E_STATE/fake-v3.log" 2>&1 &)
  sleep 1
  # Test-only fixtures; removed again by `down`.
  psql "$E2E_DATABASE_URL" -q -c "
    delete from ai_sessions where user_id like 'itest%'; delete from ai_user_state where user_id like 'itest%';
    delete from ai_user_routines where user_id like 'itest%'; delete from ai_routine_proposals where user_id like 'itest%';
    delete from ai_handoffs where user_id like 'itest%'; delete from ai_session_summaries where user_id like 'itest%'; delete from ai_message_reports; delete from ai_assessment_referrals where user_id like 'itest%'; delete from ai_instrument_responses where user_id like 'itest%';
    delete from ai_dataset_items where user_id like 'itest%'; delete from ai_dataset_exports where exported_by = 'e2e'; delete from ai_data_gates where reference like 'E2E-%'; delete from ai_psikolog_data_consents where psychologist_id like 'PSY-%';
    delete from ai_consents where user_id like 'itest%'; delete from ai_outbox; delete from ai_sync_cursors; delete from ai_local_tasks;
    delete from ai_inbound_events where event_id like 'v3-deleted-data:%' or event_id like 'itest%';
    $(cleanup_phase5)
    insert into ai_content_versions (id, kind, ref_id, version, body, status, author_id)
      values (gen_random_uuid(), 'assessment_mapping', 'rokok', 900, '{\"topic\":\"rokok\",\"assessment_product_ids\":[\"ASM-TEST\"]}', 'draft', 'seed:e2e')
      on conflict do nothing;
    insert into ai_handoff_psikologs (psychologist_id, updated_at) values ('PSY-TEST', now()) on conflict do nothing;
    -- Phase 4: existing scenarios run as users who already agreed to the service terms.
    insert into ai_consents (id, user_id, type, text_version, granted)
      select gen_random_uuid(), u, 'service', 1, true
      from unnest(array['itest-a','itest-b','itest-quota','itest-crisis','itest-down','itest-p4-del','itest-p4-pull','itest-p4-from','itest-p4-to',
                   'itest-p8-a','itest-p8-del','itest-p8-from','itest-p8-to',
                   'itest-p9-a','itest-p9-b','itest-p9-crisis']) u;"
  redis-cli -u "$REDIS_URL" flushdb > /dev/null
  agent
  gateways
}

# Phase 5 test rows: personas and content written by test psikolog, staff roles.
cleanup_phase5() {
  echo "delete from ai_eval_runs where persona_id like 'ps-psy-%'; delete from ai_eval_cases where persona_id like 'ps-psy-%';
    delete from ai_persona_workspaces where psychologist_id like 'PSY-%'; delete from ai_personas where id like 'ps-psy-%';
    delete from ai_content_versions where author_id like 'PSY-%' or ref_id like 'ps-psy-%' or author_id = 'seed:e2e';
    delete from ai_staff_roles where psychologist_id like 'PSY-%';"
}

down() {
  stop_port 18081; stop_port 18082; stop_port 8000; stop_port 18300
  psql "$E2E_DATABASE_URL" -q -c "
    $(cleanup_phase5)
    delete from ai_consents where user_id like 'itest%';
    delete from ai_instrument_responses where user_id like 'itest%';
    delete from ai_dataset_items where user_id like 'itest%'; delete from ai_data_gates where reference like 'E2E-%';
    delete from ai_psikolog_data_consents where psychologist_id like 'PSY-%'; delete from ai_dataset_exports where exported_by = 'e2e';
    delete from ai_handoff_psikologs where psychologist_id = 'PSY-TEST';" || true
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  agent) agent ;;
  stop-agent) stop_port 8000 ;;
  gateways) gateways ;;
  *) echo "usage: $0 up|down|agent|stop-agent|gateways" >&2; exit 2 ;;
esac
