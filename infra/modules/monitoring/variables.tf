variable "project_id" {
  type        = string
  description = "GCP project of the environment."
}

variable "environment" {
  type        = string
  description = "dev | staging | prod — used in names and alert text."
}

variable "notification_channels" {
  type        = list(string)
  description = "Cloud Monitoring notification channel IDs of the on-call channel (Q12)."
  default     = []
}

variable "gateway_url" {
  type        = string
  description = "Public gateway base URL (https://…), for the uptime check on /v1/health."
}

variable "billing_account" {
  type        = string
  description = "Billing account ID for the monthly budget alert; empty = no budget."
  default     = ""
}

variable "monthly_budget_idr" {
  type        = number
  description = "Monthly budget in IDR (02 §12.3)."
  default     = 0
}

variable "slo" {
  description = "Targets of 02 §12.2."
  type = object({
    availability      = number
    first_token_p95   = number
    error_rate        = number
    l2_timeout_rate   = number
    turn_duration_p95 = number
  })
  default = {
    availability      = 0.995
    first_token_p95   = 4000
    error_rate        = 0.01
    l2_timeout_rate   = 0.005
    turn_duration_p95 = 30000
  }
}
