# Monthly budget alert (02 §12.3). Needs the billing account; skipped when empty.
resource "google_billing_budget" "monthly" {
  count           = var.billing_account == "" || var.monthly_budget_idr <= 0 ? 0 : 1
  billing_account = var.billing_account
  display_name    = "DeepTalk AI ${var.environment} — bulanan"

  budget_filter {
    projects = ["projects/${var.project_id}"]
  }
  amount {
    specified_amount {
      currency_code = "IDR"
      units         = tostring(var.monthly_budget_idr)
    }
  }
  dynamic "threshold_rules" {
    for_each = [0.5, 0.9, 1.0]
    content {
      threshold_percent = threshold_rules.value
    }
  }
  all_updates_rule {
    monitoring_notification_channels = var.notification_channels
    disable_default_iam_recipients   = false
  }
}
