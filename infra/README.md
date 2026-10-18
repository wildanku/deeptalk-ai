# infra/

Terraform untuk Google Cloud `asia-southeast2` (02 §11). Topologi tahap awal ([topologi deployment](../../docs/deeptalk-ai/topologi-deployment-151026.md)): gateway dan agent di Cloud Run; Postgres AI, Redis, web, v3, dan psikolog-service di VM GCE + Dokploy dalam proyek dan VPC yang sama; antrian gateway di Cloud Tasks. Postgres/Redis di VM dikelola lewat Dokploy, bukan Terraform. Model Gemini dipanggil lewat Gemini Enterprise Agent Platform di region `us` (02 §9.1); itu bukan resource Terraform, cukup `aiplatform.googleapis.com` aktif dan role `roles/aiplatform.user` untuk service account agent. Satu proyek GCP per lingkungan, satu root module per lingkungan di `envs/`, komponen bersama di `modules/`.

```
infra/
├── envs/{dev,staging,prod}/   # root module per lingkungan (state terpisah di GCS)
└── modules/                   # komponen yang dipakai ulang
```

## Pemakaian

```bash
cd infra/envs/dev
cp backend.hcl.example backend.hcl            # isi bucket state (tidak di-commit)
cp terraform.tfvars.example terraform.tfvars  # isi project_id (tidak di-commit)
terraform init -backend-config=backend.hcl
terraform plan
```

`backend.hcl` dan `*.tfvars` diabaikan git. Commit `.terraform.lock.hcl` setelah `init` pertama agar versi provider terkunci.

## Rencana modul

| Modul | Isi | Phase |
|---|---|---|
| `project-services` ✅ | Mengaktifkan API yang dibutuhkan | 0 |
| `network` | VPC + subnet `asia-southeast2`, firewall (Cloud Run → VM: 5432/6379 hanya dari subnet egress), Direct VPC egress untuk gateway | 0–1 |
| `dokploy-vm` | VM GCE (IP internal statis, disk persisten + jadwal snapshot), tanpa port database publik | 0–1 |
| `kms` | Key ring + key enkripsi isi pesan | 1 |
| `secrets` | Secret Manager (token servis, webhook) | 1 |
| `artifact-registry` | Image gateway dan agent | 1 |
| `cloud-run` | gateway (≥2 instance di prod, session affinity, timeout 3600 dtk) dan agent (privat, IAM invoker) | 1 |
| `tasks` | Queue Cloud Tasks `ai-session-timers`, `ai-outbox`, `ai-lifecycle`, `ai-evals` + kebijakan retry | 1 |
| `scheduler` | Cloud Scheduler → gateway: `outbox-sweep`, `account-sync`, `retention`, `routine-reminders` | 3 |
| `monitoring` ✅ | Log-based metrics, SLO ketersediaan, alert (krisis, krisis tanpa protokol, error, timeout L2, token pertama p95, gateway mati), dashboard, anggaran — `docs/slo.md` | 6 |
