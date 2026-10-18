# One dashboard per environment with the SLO indicators and cost (02 §12.2–§12.3).
locals {
  charts = [
    { title = "Token pertama p95 (ms)", query = "histogram_quantile(0.95, sum by (le) (rate(logging_googleapis_com:user_ai_turn_first_token_ms_bucket[5m])))" },
    { title = "Giliran per outcome", query = "sum by (outcome) (rate(logging_googleapis_com:user_ai_turn[5m]))" },
    { title = "Durasi giliran p95 (ms)", query = "histogram_quantile(0.95, sum by (le) (rate(logging_googleapis_com:user_ai_turn_duration_ms_bucket[15m])))" },
    { title = "Agent L2 p95 (ms)", query = "histogram_quantile(0.95, sum by (le) (rate(logging_googleapis_com:user_agent_turn_l2_ms_bucket[15m])))" },
    { title = "Agent token pertama persona p95 (ms)", query = "histogram_quantile(0.95, sum by (le) (rate(logging_googleapis_com:user_agent_turn_persona_first_token_ms_bucket[15m])))" },
    { title = "Error giliran per kode", query = "sum by (error) (rate(logging_googleapis_com:user_ai_turn{outcome=\"error\"}[15m]))" },
    { title = "Rasio timeout L2", query = "sum(rate(logging_googleapis_com:user_l2_verdict{timed_out=\"true\"}[15m])) / sum(rate(logging_googleapis_com:user_l2_verdict[15m]))" },
    { title = "Krisis terdeteksi vs protokol terkirim (1 jam)", query = "sum(increase(logging_googleapis_com:user_crisis_detected[1h])) - sum(increase(logging_googleapis_com:user_crisis_protocol_sent[1h]) or vector(0))" },
    { title = "Token output per giliran p50", query = "histogram_quantile(0.5, sum by (le, model) (rate(logging_googleapis_com:user_ai_turn_output_tokens_bucket[1h])))" },
    { title = "Token output per sesi p50", query = "histogram_quantile(0.5, sum by (le) (rate(logging_googleapis_com:user_session_tokens_output_bucket[6h])))" },
    { title = "Laporan respons AI", query = "sum by (reason) (increase(logging_googleapis_com:user_message_reported[1h]))" },
    { title = "Cek diri per tujuan dan level keamanan", query = "sum by (purpose, safety) (increase(logging_googleapis_com:user_instrument_response[1h]))" },
  ]
}

resource "google_monitoring_dashboard" "ai" {
  project = var.project_id
  dashboard_json = jsonencode({
    displayName = "DeepTalk AI — ${var.environment}"
    mosaicLayout = {
      columns = 12
      tiles = [for index, chart in local.charts : {
        xPos   = (index % 2) * 6
        yPos   = floor(index / 2) * 4
        width  = 6
        height = 4
        widget = {
          title = chart.title
          xyChart = {
            dataSets = [{
              timeSeriesQuery = { prometheusQuery = chart.query }
              plotType        = "LINE"
            }]
          }
        }
      }]
    }
  })
}
