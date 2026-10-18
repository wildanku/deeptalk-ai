# Alerts to the on-call channel (02 §12.2). PromQL names log-based metrics as
# logging_googleapis_com:user_<metric>.

locals {
  prefix = "[DeepTalk AI ${var.environment}]"
}

# Every crisis event (the CRITICAL log line written by AlertService). The webhook in the gateway
# (ALERT_WEBHOOK_URL) is the per-event path; this is the monitored one.
resource "google_monitoring_alert_policy" "crisis_event" {
  project      = var.project_id
  display_name = "${local.prefix} Kejadian crisis"
  combiner     = "OR"
  conditions {
    display_name = "ai_crisis"
    condition_matched_log {
      filter = local.alert_logs
    }
  }
  alert_strategy {
    notification_rate_limit {
      period = "300s"
    }
    auto_close = "1800s"
  }
  notification_channels = var.notification_channels
  documentation {
    content   = "Runbook: docs/runbooks/insiden-krisis.md. Alert ini tidak memuat isi percakapan."
    mime_type = "text/markdown"
  }
}

# SLO "pesan krisis yang menerima protokol = 100%": any detection without a protocol.
resource "google_monitoring_alert_policy" "crisis_protocol_gap" {
  project      = var.project_id
  display_name = "${local.prefix} Krisis tanpa protokol (SEV-1)"
  combiner     = "OR"
  conditions {
    display_name = "crisis_detected > crisis_protocol_sent"
    condition_prometheus_query_language {
      query    = "sum(increase(logging_googleapis_com:user_crisis_detected[10m])) - sum(increase(logging_googleapis_com:user_crisis_protocol_sent[10m]) or vector(0)) > 0"
      duration = "0s"
    }
  }
  notification_channels = var.notification_channels
  documentation {
    content   = "Runbook: docs/runbooks/insiden-krisis.md langkah 6."
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "turn_error_rate" {
  project      = var.project_id
  display_name = "${local.prefix} Error giliran > ${var.slo.error_rate * 100}%"
  combiner     = "OR"
  conditions {
    display_name = "ai_turn error ratio (15 menit)"
    condition_prometheus_query_language {
      query    = "sum(rate(logging_googleapis_com:user_ai_turn{outcome=\"error\"}[15m])) / sum(rate(logging_googleapis_com:user_ai_turn[15m])) > ${var.slo.error_rate}"
      duration = "300s"
    }
  }
  notification_channels = var.notification_channels
  documentation {
    content   = "Runbook: docs/runbooks/gangguan-vertex-ai.md"
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "l2_timeout_rate" {
  project      = var.project_id
  display_name = "${local.prefix} Timeout L2 > ${var.slo.l2_timeout_rate * 100}%"
  combiner     = "OR"
  conditions {
    display_name = "l2_verdict timed_out ratio (15 menit)"
    condition_prometheus_query_language {
      query    = "sum(rate(logging_googleapis_com:user_l2_verdict{timed_out=\"true\"}[15m])) / sum(rate(logging_googleapis_com:user_l2_verdict[15m])) > ${var.slo.l2_timeout_rate}"
      duration = "300s"
    }
  }
  notification_channels = var.notification_channels
  documentation {
    content   = "Runbook: docs/runbooks/gangguan-vertex-ai.md langkah 5."
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "first_token_p95" {
  project      = var.project_id
  display_name = "${local.prefix} Token pertama p95 > ${var.slo.first_token_p95} ms"
  combiner     = "OR"
  conditions {
    display_name = "ai_turn_first_token_ms p95 (15 menit)"
    condition_prometheus_query_language {
      query    = "histogram_quantile(0.95, sum by (le) (rate(logging_googleapis_com:user_ai_turn_first_token_ms_bucket[15m]))) > ${var.slo.first_token_p95}"
      duration = "600s"
    }
  }
  notification_channels = var.notification_channels
  documentation {
    content   = "Runbook: docs/runbooks/gangguan-vertex-ai.md"
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_uptime_check_config" "gateway_health" {
  project      = var.project_id
  display_name = "${local.prefix} gateway /v1/health"
  timeout      = "10s"
  period       = "60s"
  http_check {
    path         = "/v1/health"
    use_ssl      = true
    validate_ssl = true
  }
  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = trimsuffix(replace(var.gateway_url, "https://", ""), "/")
    }
  }
}

resource "google_monitoring_alert_policy" "gateway_down" {
  project      = var.project_id
  display_name = "${local.prefix} Gateway tidak menjawab /v1/health"
  combiner     = "OR"
  conditions {
    display_name = "uptime check gagal"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.gateway_health.uptime_check_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "120s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.project_id"]
      }
    }
  }
  notification_channels = var.notification_channels
  documentation {
    content   = "Runbook: docs/runbooks/gangguan-vertex-ai.md §Gateway"
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "turn_duration_p95" {
  project      = var.project_id
  display_name = "${local.prefix} Durasi giliran p95 > ${var.slo.turn_duration_p95} ms"
  combiner     = "OR"
  conditions {
    display_name = "ai_turn_duration_ms p95 (15 menit)"
    condition_prometheus_query_language {
      query    = "histogram_quantile(0.95, sum by (le) (rate(logging_googleapis_com:user_ai_turn_duration_ms_bucket[15m]))) > ${var.slo.turn_duration_p95}"
      duration = "600s"
    }
  }
  notification_channels = var.notification_channels
  documentation {
    content   = "Runbook: docs/runbooks/gangguan-vertex-ai.md (bagian giliran lambat). Lihat agent_turn_* untuk tahap yang lambat."
    mime_type = "text/markdown"
  }
}
