# Availability SLO (02 §12.2): share of gateway requests (Cloud Run) answered without a 5xx,
# rolling 30 days. Turn quality SLOs (first token, errors, L2, crisis protocol) are alerts in
# alerts.tf because they come from log-based metrics.

resource "google_monitoring_custom_service" "gateway" {
  project      = var.project_id
  service_id   = "deeptalk-ai-gateway"
  display_name = "DeepTalk AI gateway (${var.environment})"
}

resource "google_monitoring_slo" "availability" {
  project      = var.project_id
  service      = google_monitoring_custom_service.gateway.service_id
  slo_id       = "availability"
  display_name = "Ketersediaan gateway ${var.slo.availability * 100}% (30 hari)"

  goal                = var.slo.availability
  rolling_period_days = 30

  request_based_sli {
    good_total_ratio {
      bad_service_filter   = "metric.type=\"run.googleapis.com/request_count\" resource.type=\"cloud_run_revision\" resource.label.\"service_name\"=\"gateway\" metric.label.\"response_code_class\"=\"5xx\""
      total_service_filter = "metric.type=\"run.googleapis.com/request_count\" resource.type=\"cloud_run_revision\" resource.label.\"service_name\"=\"gateway\""
    }
  }
}

resource "google_monitoring_alert_policy" "availability_burn" {
  project      = var.project_id
  display_name = "[DeepTalk AI ${var.environment}] Error budget ketersediaan terbakar cepat"
  combiner     = "OR"
  conditions {
    display_name = "burn rate > 10 (1 jam)"
    condition_threshold {
      filter          = "select_slo_burn_rate(\"${google_monitoring_slo.availability.id}\", \"3600s\")"
      comparison      = "COMPARISON_GT"
      threshold_value = 10
      duration        = "0s"
    }
  }
  notification_channels = var.notification_channels
}
