terraform {
  required_version = ">= 1.9"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.0"
    }
  }

  # Partial config: terraform init -backend-config=backend.hcl (see backend.hcl.example)
  backend "gcs" {}
}

provider "google" {
  project = var.project_id
  region  = var.region
}

variable "project_id" {
  type        = string
  description = "GCP project for the staging environment."
}

variable "region" {
  type        = string
  description = "All stored data stays in Jakarta; Gemini runs in `us` (02 §9.1)."
  default     = "asia-southeast2"
}

module "project_services" {
  source     = "../../modules/project-services"
  project_id = var.project_id
}

# Next (Phase 0–1): network + firewall to the Dokploy VM, KMS, Secret Manager, Artifact Registry,
# Cloud Run (gateway, agent), Cloud Tasks queues, Scheduler, IAM — see infra/README.md.
# Postgres and Redis run on the Dokploy VM, not as managed services.

variable "gateway_url" {
  type        = string
  description = "Public gateway URL (https://…), for the uptime check. Set once Cloud Run exists."
  default     = ""
}

variable "notification_channels" {
  type        = list(string)
  description = "On-call notification channel IDs (Q12)."
  default     = []
}

variable "billing_account" {
  type        = string
  description = "Billing account for the monthly budget alert."
  default     = ""
}

variable "monthly_budget_idr" {
  type        = number
  description = "Monthly budget in IDR (0 = no budget alert; prod amount to be decided)."
  default     = 3000000
}

# SLO, alerts, dashboard, budget (03 Phase 6). Needs the gateway on Cloud Run for the uptime check.
module "monitoring" {
  source                = "../../modules/monitoring"
  count                 = var.gateway_url == "" ? 0 : 1
  project_id            = var.project_id
  environment           = "staging"
  gateway_url           = var.gateway_url
  notification_channels = var.notification_channels
  billing_account       = var.billing_account
  monthly_budget_idr    = var.monthly_budget_idr
}
