# Log-based metrics from the gateway's structured `metric` lines (MetricsService). The lines
# carry enums, counts and durations only — never content or user IDs (02 §9.1).

locals {
  gateway_logs = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"gateway\""
  agent_logs   = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"agent\""
  alert_logs   = "${local.gateway_logs} AND jsonPayload.alert=\"ai_crisis\""
}

resource "google_logging_metric" "ai_turn" {
  project = var.project_id
  name    = "ai_turn"
  filter  = "${local.gateway_logs} AND jsonPayload.metric=\"ai_turn\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    labels {
      key        = "outcome"
      value_type = "STRING"
    }
    # Why a turn failed: TIMEOUT_TOTAL/TIMEOUT_IDLE (gateway clock), MODEL_TIMEOUT/MODEL_ERROR
    # (agent), AGENT_UNAVAILABLE (unreachable, IAM). Empty on success.
    labels {
      key        = "error"
      value_type = "STRING"
    }
  }
  label_extractors = {
    outcome = "EXTRACT(jsonPayload.outcome)"
    error   = "EXTRACT(jsonPayload.error)"
  }
}

# Whole turn as the gateway sees it (router, context, agent stream up to `done`).
resource "google_logging_metric" "turn_duration_ms" {
  project         = var.project_id
  name            = "ai_turn_duration_ms"
  filter          = "${local.gateway_logs} AND jsonPayload.metric=\"ai_turn\" AND jsonPayload.outcome=\"ok\""
  value_extractor = "EXTRACT(jsonPayload.duration_ms)"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "DISTRIBUTION"
    unit        = "ms"
  }
  bucket_options {
    exponential_buckets {
      num_finite_buckets = 40
      growth_factor      = 1.25
      scale              = 100
    }
  }
}

# Agent step durations from its `turn timing` line (-1 = step not reached, filtered out).
resource "google_logging_metric" "agent_turn_step_ms" {
  for_each        = toset(["l2_ms", "persona_first_token_ms", "persona_ms", "cards_ms", "total_ms"])
  project         = var.project_id
  name            = "agent_turn_${each.key}"
  filter          = "${local.agent_logs} AND jsonPayload.turn_timing.${each.key}>=0"
  value_extractor = "EXTRACT(jsonPayload.turn_timing.${each.key})"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "DISTRIBUTION"
    unit        = "ms"
  }
  bucket_options {
    exponential_buckets {
      num_finite_buckets = 40
      growth_factor      = 1.25
      scale              = 50
    }
  }
}

resource "google_logging_metric" "first_token_ms" {
  project         = var.project_id
  name            = "ai_turn_first_token_ms"
  filter          = "${local.gateway_logs} AND jsonPayload.metric=\"ai_turn\" AND jsonPayload.outcome=\"ok\" AND jsonPayload.first_token_ms>=0"
  value_extractor = "EXTRACT(jsonPayload.first_token_ms)"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "DISTRIBUTION"
    unit        = "ms"
  }
  bucket_options {
    exponential_buckets {
      num_finite_buckets = 40
      growth_factor      = 1.25
      scale              = 50
    }
  }
}

resource "google_logging_metric" "l2_verdict" {
  project = var.project_id
  name    = "l2_verdict"
  filter  = "${local.gateway_logs} AND jsonPayload.metric=\"l2_verdict\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    labels {
      key        = "timed_out"
      value_type = "STRING"
    }
  }
  label_extractors = { timed_out = "EXTRACT(jsonPayload.timed_out)" }
}

resource "google_logging_metric" "crisis_detected" {
  project = var.project_id
  name    = "crisis_detected"
  filter  = "${local.gateway_logs} AND jsonPayload.metric=\"crisis_detected\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

resource "google_logging_metric" "crisis_protocol_sent" {
  project = var.project_id
  name    = "crisis_protocol_sent"
  filter  = "${local.gateway_logs} AND jsonPayload.metric=\"crisis_protocol_sent\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

resource "google_logging_metric" "turn_tokens" {
  for_each        = toset(["input_tokens", "output_tokens"])
  project         = var.project_id
  name            = "ai_turn_${each.key}"
  filter          = "${local.gateway_logs} AND jsonPayload.metric=\"ai_turn\" AND jsonPayload.outcome=\"ok\""
  value_extractor = "EXTRACT(jsonPayload.${each.key})"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "DISTRIBUTION"
    labels {
      key        = "model"
      value_type = "STRING"
    }
  }
  label_extractors = { model = "EXTRACT(jsonPayload.model)" }
  bucket_options {
    exponential_buckets {
      num_finite_buckets = 30
      growth_factor      = 1.5
      scale              = 10
    }
  }
}

# Cost per session (02 §12.3): total persona tokens of a finished session.
resource "google_logging_metric" "session_tokens" {
  project         = var.project_id
  name            = "session_tokens_output"
  filter          = "${local.gateway_logs} AND jsonPayload.metric=\"session_ended\""
  value_extractor = "EXTRACT(jsonPayload.tokens_output)"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "DISTRIBUTION"
  }
  bucket_options {
    exponential_buckets {
      num_finite_buckets = 30
      growth_factor      = 1.5
      scale              = 50
    }
  }
}

resource "google_logging_metric" "message_reported" {
  project = var.project_id
  name    = "message_reported"
  filter  = "${local.gateway_logs} AND jsonPayload.metric=\"message_reported\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    labels {
      key        = "reason"
      value_type = "STRING"
    }
  }
  label_extractors = { reason = "EXTRACT(jsonPayload.reason)" }
}

# Phase 8: check-in, screening, and inventory answers — purpose and safety level only.
resource "google_logging_metric" "instrument_response" {
  project = var.project_id
  name    = "instrument_response"
  filter  = "${local.gateway_logs} AND jsonPayload.metric=\"instrument_response\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    labels {
      key        = "purpose"
      value_type = "STRING"
    }
    labels {
      key        = "safety"
      value_type = "STRING"
    }
  }
  label_extractors = {
    purpose = "EXTRACT(jsonPayload.purpose)"
    safety  = "EXTRACT(jsonPayload.safety)"
  }
}
