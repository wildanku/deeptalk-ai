# Enables the Google Cloud APIs DeepTalk AI depends on (03 Phase 0).

variable "project_id" {
  type        = string
  description = "GCP project ID."
}

variable "services" {
  type        = set(string)
  description = "APIs to enable."
  default = [
    "aiplatform.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudkms.googleapis.com",
    "cloudscheduler.googleapis.com",
    "cloudtasks.googleapis.com",
    "cloudtrace.googleapis.com",
    # GCE VM running Dokploy (Postgres, Redis, web, v3, psikolog-service) and the VPC that Cloud
    # Run reaches it through (Direct VPC egress) — docs/deeptalk-ai/topologi-deployment-151026.md.
    "compute.googleapis.com",
    "iam.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
  ]
}

resource "google_project_service" "this" {
  for_each = var.services

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
