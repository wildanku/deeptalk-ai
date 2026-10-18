# Cek Kesiapan Deploy deeptalk-ai ke Cloud Run

**Tanggal:** 2026-10-16
**Komponen:** gateway, agent, cloudbuild, infra
**Terkait:** [blocker lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md), [uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md), [latensi-l2-argon](../blockers/latensi-l2-argon.md)

## Daftar Pekerjaan

- [x] Dockerfile gateway: image runtime disimulasikan (hanya dependensi production + `dist`) → boot; satu-satunya error mode production = env integrasi belum diisi (sesuai desain)
- [x] Dockerfile agent: runtime tidak mengimpor `evals/`/`tests/` (dikecualikan `.dockerignore`); validasi `APP_ENV=production` gagal tertutup dengan benar
- [x] `.dockerignore` gateway/agent: `.env` dan `node_modules`/`.venv` tidak ikut image
- [x] **Perbaikan:** gateway dengan `NODE_ENV=development` di image runtime crash (`unable to determine transport target for "pino-pretty"`). Lingkungan `dev` butuh mode ini untuk konten DRAFT. Logger kini memakai `pino-pretty` hanya bila terpasang, selain itu JSON (Cloud Logging). Diverifikasi di image tiruan: boot, `/v1/health` OK, log JSON ber-`severity`. Spec baru di `logger.spec.ts`
- [x] Inventaris env gateway/agent, queue Cloud Tasks, rute scheduler (lihat panduan di chat)
- [x] Opsi deploy prototype (permintaan Wildan: sesedikit mungkin layanan, belum perlu keamanan penuh): mode `development` sudah mengizinkan env biasa (tanpa Secret Manager), `MESSAGE_LOCAL_KEY` (tanpa KMS), dan `TASKS_DRIVER=local` (tanpa Cloud Tasks; `LocalScheduler` menggantikan Cloud Scheduler)
- [x] **Perubahan:** `routine-reminders` kini juga job terjadwal (`RemindersService` → `registerJob`, `LocalScheduler` tiap 5 menit) sehingga Cloud Scheduler tidak dibutuhkan; Cloud Scheduler tetap bisa memanggil `/v1/internal/scheduler/jobs/routine-reminders`. Diverifikasi di gateway lokal: task `scheduled-routine-reminders-*` dieksekusi. Spec `tasks.spec.ts` diperluas; gateway 288 test, e2e, build hijau
- [ ] Deploy sungguhan — belum: lihat Blocker
- [x] **Troubleshooting deploy prototype (2026-10-17):** `describeError` (nama, kode, `db_code`/`db_kind` Prisma, `status`, dan `where` = frame pertama kode sendiri, tanpa pesan) dipakai di filter HTTP, antrian lokal, scheduler, outbox, dan giliran. Dengan ini terungkap `28P01` (kredensial DB) dan 403 (invoker agent)
- [x] Agent `/v1/turn`: exception sebelum vonis safety kini jadi event `error` `AGENT_ERROR` + log nama tipe dan `file:baris` (sebelumnya stream tertutup kosong → gateway `MISSING_SAFETY_VERDICT`)
- [x] Gateway: jawaban 200 yang bukan SSE → `AgentUnavailableError` kode `NOT_EVENT_STREAM`; ringkasan sesi tanpa `summary` → `BAD_RESPONSE` (sebelumnya `TypeError ERR_INVALID_ARG_TYPE` di enkripsi). Gateway 294 test, e2e, lint, typecheck, build hijau
- [ ] Penyebab `MISSING_SAFETY_VERDICT` + `ERR_INVALID_ARG_TYPE` di Cloud Run — belum: perlu log agent dan revisi berikutnya (`where`/kode baru)

## Blocker untuk deploy

1. **v3 belum punya modul AI di dev/prod**: `feat/ai-phase-1` (1 commit) belum di-merge ke `deploy/prod` (maju 8 commit; merge tanpa konflik). `api-deeptalk.lgs.web.id/v2/.well-known/ai-jwks.json` → 404.
2. **Infrastruktur GCP belum dibuat**: hanya proyek trial `deeptalk-496008` + SA `agent-run`/`gateway-run`. Belum ada Artifact Registry, KMS, Secret Manager, Cloud Tasks, Cloud Scheduler, VPC/VM Postgres+Redis, Cloud Run. Modul Terraform untuk itu baru rencana (hanya `project-services` dan `monitoring` yang ada); `cloudbuild/*.yaml` belum pernah dijalankan.
3. **Mesin lokal tanpa `gcloud`/`docker`/`terraform`** — deploy lewat Cloud Shell atau pasang `gcloud`.
4. **Konten belum `approved`**: mode production menolak DRAFT → tanpa persetujuan konten (persetujuan layanan, protokol, persona) pengguna ditolak di onboarding. Deploy pertama = lingkungan `dev` dengan `NODE_ENV=development` + `CONTENT_ALLOW_DRAFT=true`.
5. **Latensi L2 Argon** 2,6–4,2 dtk > default `SAFETY_TIMEOUT_MS` 3.000 → set 6000 di agent.

## File yang Diubah

- `gateway/src/observability/logger.ts`, `logger.spec.ts`
- `gateway/src/routines/reminders.service.ts`, `gateway/src/tasks/tasks.module.ts`, `gateway/src/tasks/tasks.spec.ts`
- `gateway/src/common/describe-error.ts` (+spec), `gateway/src/common/filters/http-exception.filter.spec.ts`
- `gateway/src/agent-client/agent-client.service.ts` (+spec), `gateway/src/agent-client/agent-events.ts`, `gateway/src/realtime/conversation.service.ts`
- `agent/app/routes/v1.py`, `agent/tests/test_turn.py`
- `docs/tasks/20261016-kesiapan-deploy-cloud-run.md`

## Rekap Status

- **Selesai:** 10/12
- **Belum:** deploy sungguhan (menunggu blocker 1–3); penyebab error giliran di Cloud Run (menunggu log)
- **Status task:** 🟨 Sebagian — artefak siap untuk `dev`; prasyarat v3 dan infrastruktur GCP belum ada.
