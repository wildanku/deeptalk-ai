# cloudbuild/

Pipeline Cloud Build (02 §11). Trigger per lingkungan menunjuk file di sini dengan substitusi `_ENV`.

| File | Isi |
|---|---|
| `gateway.yaml` | lint + typecheck → unit + e2e → image `runtime` dan `migrate` → Cloud Run Job `gateway-migrate` (`prisma migrate deploy`) → revisi baru tanpa traffic → canary `_CANARY_PERCENT` |
| `agent.yaml` | ruff + mypy + pytest → image → revisi baru tanpa traffic → canary |
| `promote.yaml` | **Gerbang evaluasi safety** (L1 dari frasa `approved` di DB + L2 dengan model Vertex; recall krisis harus 100%), lalu promosi tag canary ke 100% |

Gerbang lokal (tanpa GCP): `pnpm run eval:l1 <cases> l1.json` di `gateway/`, lalu `MODEL_PROVIDER=local uv run python -m evals.safety <cases> l1.json` di `agent/`.

Konfigurasi layanan (env, secret, VPC, service account, min instance, session affinity, timeout 3600 detik, ingress agent internal) dikelola di `infra/`, bukan di pipeline. Studi kasus saat ini `DRAFT` sintetis; set final dari psikolog menggantikannya (`_CASES`).

Status: ditulis di Phase 1 tanpa akses GCP; belum pernah dijalankan.
