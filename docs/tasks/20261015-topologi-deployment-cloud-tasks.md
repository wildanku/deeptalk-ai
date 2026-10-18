# Topologi Deployment Awal + Cloud Tasks

**Tanggal:** 2026-10-15
**Phase:** Phase 0/1 (infrastruktur), [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md)
**Komponen:** gateway, agent, infra, e2e, docs, `deeptalk-web-v2`, `deeptalk-api-v3`, psikolog-service

## Tujuan

Menyesuaikan repo dengan topologi deployment tahap awal (keputusan Wildan, 15 Okt 2026):

| Service | Tempat |
|---|---|
| deeptalk-ai (gateway, agent) | Cloud Run (`asia-southeast2`) |
| deeptalk-web-v2, deeptalk-api-v3, psikolog-service | VM Compute Engine + Dokploy, proyek dan VPC GCP yang sama |
| Postgres, Redis, dan data store lain | VM + Dokploy. deeptalk-ai memakai **service Postgres terpisah** |
| Antrian | **Google Cloud Tasks** untuk deeptalk-ai saja. BullMQ v3 yang sudah production tidak diubah |

Dokumen utama: [`docs/deeptalk-ai/topologi-deployment-151026.md`](../../../docs/deeptalk-ai/topologi-deployment-151026.md) (root logos-dev).

## Daftar Pekerjaan

### Gateway: BullMQ → Cloud Tasks
- [x] Abstraksi antrian (`TaskQueue`) dengan driver `cloud` (Cloud Tasks, target HTTP ke gateway) dan `local` (Postgres `ai_local_tasks`, untuk dev/E2E; ditolak di production)
- [x] Endpoint penerima task `POST /v1/internal/tasks/:queue` (header `x-tasks-token`, 204; handler idempoten)
- [x] Timer sesi, outbox, lifecycle (sapuan ulang hapus/merge), dan evaluasi persona pindah ke `TaskQueue`
- [x] Job berulang (`outbox-sweep`, `account-sync`, `retention`) dipicu Cloud Scheduler lewat `POST /v1/internal/scheduler/jobs/:job`; driver lokal punya `LocalScheduler`
- [x] BullMQ (`@nestjs/bullmq`, `bullmq`, `ioredis`) dihapus dari gateway; Redis tetap untuk adapter Socket.IO, lock, rate limit, dan cache (`QUEUE_PREFIX` → `REDIS_PREFIX`)
- [x] Env baru di skema (`TASKS_DRIVER`, `TASKS_LOCATION`, `TASKS_TARGET_URL`, `TASKS_TOKEN`, `REDIS_PREFIX`), `.env.example`, 02 §11.1
- [x] Unit test (6 baru), E2E regresi penuh termasuk restart semua gateway di tengah sesi
- [x] Allow-list path tracing menerima segmen rute task/job baru (bukan diganti `:id`)

### Koneksi ke VM
- [x] Gateway: Postgres dan Redis di VM lewat IP privat (Direct VPC egress); Redis dengan password. Tidak butuh perubahan kode (`DATABASE_URL`/`REDIS_URL`); didokumentasikan
- [x] Dokumentasi jaringan dan firewall: VPC custom, subnet `run-egress`, port 5433/6380 hanya dari subnet itu, SSH lewat IAP, panel Dokploy tidak dibuka

### Repo lain
- [x] deeptalk-web-v2: `Dockerfile` + `.dockerignore` + `output: "standalone"`, sesuai dokumentasi Next 16 (`node_modules/next/dist/docs`)
- [x] deeptalk-api-v3: cek kesiapan Dokploy — tanpa perubahan kode. Dockerfile build dari source, migrasi via `RUN_DB_MIGRATIONS`, `PSIKOLOG_URL` bisa internal. Modul AI belum ada di `deploy/prod`; merge `feat/ai-phase-1` bersih tetapi belum dilakukan (butuh review pemilik v3)
- [x] psikolog-service: cek kesiapan Dokploy — tanpa perubahan (Dockerfile port 3000, migrasi otomatis di entrypoint, Postgres + Redis, tanpa antrian)
- [ ] Image web di-`docker build` — Docker tidak terpasang ([tooling-lokal-terraform-docker](../blockers/tooling-lokal-terraform-docker.md)); server standalone sudah diverifikasi

### Dokumentasi
- [x] Dokumen topologi deployment di `docs/deeptalk-ai/` (diagram, perubahan repo, jaringan, VM + Dokploy, Cloud Run, Cloud Tasks, Scheduler, matriks env, urutan deploy, checklist verifikasi, risiko)
- [x] Panduan setup GCP §1.4 dan §5 disesuaikan (API `cloudtasks`/`compute`; tanpa Cloud SQL/Memorystore; jaringan + firewall; queue; image migrate; Direct VPC egress; env `TASKS_*`). Juga memperbaiki instruksi lama `content:seed` lewat job, yang tidak bisa jalan karena image tidak memuat skrip seed (sekarang lewat tunnel IAP)
- [x] 02 (§3 diagram, A8, A10, §6.3 timer, §6.5, §7.3, §8 judul + `ai_local_tasks`, §9.1 akses/backup, §9.3, §11 lingkungan + topologi, §11.1 env), 03 (Phase 0–2, 4, 6), AGENT.md, README, skill gateway, `infra/` (API, README, komentar env), DPIA, runbook (`restore-cloud-sql` → `restore-postgres-ai`, gangguan, kebocoran), blocker (`lingkungan-gcp-dev`, `tooling`, `uji-client-ke-v3-dev`), `blocker-151026.md`, baris deployment di `deeptalk-web-v2/docs/phase/README.md`
- [x] Koreksi nama env `AI_ROLLOUT_USER_IDS` → `AI_ALLOWED_USER_IDS` (yang dipakai kode v3) di blocker `lingkungan-gcp-dev`

### Di GCP (bukan pekerjaan repo)
- [ ] Membuat VM, Dokploy, queue, job Scheduler, dan menguji driver Cloud Tasks sungguhan — terblokir: [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md)

## File yang Diubah

**gateway**
- `package.json`, `pnpm-lock.yaml` — `-@nestjs/bullmq -bullmq -ioredis +@google-cloud/tasks`
- `prisma/schema.prisma`, `prisma/migrations/20261015075559_local_tasks/` — tabel `ai_local_tasks`; komentar header
- `src/tasks/` (baru): `task-queue.ts`, `task-handlers.ts`, `cloud-tasks.queue.ts`, `local-task.queue.ts`, `tasks.module.ts`, `tasks.spec.ts`
- `src/queue/` — dihapus
- `src/sessions/session-timers.service.ts`, `sessions.module.ts` (processor dihapus)
- `src/outbox/outbox.service.ts`, `outbox.module.ts` (processor dihapus)
- `src/lifecycle/lifecycle.service.ts`, `lifecycle.module.ts` (processor dihapus)
- `src/evals/eval-runs.service.ts` + spec, `evals.module.ts` (processor dihapus)
- `src/auth/internal-token.guard.ts` — pemanggil `tasks`
- `src/config/env.schema.ts` + spec, `.env.example`
- `src/redis/redis.service.ts`, `src/database/prisma.service.ts`, `scripts/knowledge-budget.ts` — komentar
- `src/observability/tracing.ts` — allow-list segmen task/job
- `src/app.module.ts` — `QueueModule` → `TasksModule`

**deeptalk-ai lain**
- `e2e/stack.sh` — `TASKS_DRIVER=local`, `TASKS_TOKEN`, `REDIS_PREFIX`, bersihkan `ai_local_tasks`
- `infra/modules/project-services/main.tf`, `infra/envs/{dev,staging,prod}/main.tf`, `infra/README.md`, `docker-compose.yml`
- `README.md`, `AGENT.md`, `.claude/skills/gateway/SKILL.md`
- `docs/02-implementasi.md`, `docs/03-phase.md`, `docs/data/dpia-phase-9-engineering.md`
- `docs/runbooks/restore-postgres-ai.md` (baru, menggantikan `restore-cloud-sql.md`), `docs/runbooks/README.md`, `gangguan-vertex-ai.md`, `kebocoran-data.md`
- `docs/blockers/lingkungan-gcp-dev.md`, `tooling-lokal-terraform-docker.md`, `uji-client-ke-v3-dev.md`
- `docs/tasks/20261011-phase-6-hardening-produksi.md` — hanya tautan runbook

**deeptalk-web-v2**
- `Dockerfile` (baru), `.dockerignore` (baru), `next.config.ts`, `docs/phase/README.md`

**logos-dev/docs/deeptalk-ai**
- `topologi-deployment-151026.md` (baru), `setup-gcp-agent-platform-argon.md`, `blocker-151026.md`

**Tidak diubah:** `deeptalk-api-v3`, psikolog-service.

## Keputusan

- **Cloud Tasks memanggil gateway lewat HTTP** (`/v1/internal/tasks/:queue`), bukan pull. Cocok dengan Cloud Run yang bisa menskalakan ke instance mana pun, dan tidak ada worker yang harus tetap hidup.
- **Autentikasi task dengan header token (`x-tasks-token`)**, bukan OIDC, mengikuti pola `x-scheduler-token`/`x-ai-gateway-token` yang sudah ada. Tidak perlu `iam.serviceAccountUser` dan bisa diuji sama di lokal.
- **Nama task = kunci idempotensi.** Nama memuat waktu jatuh tempo (timer) atau nomor percobaan (outbox), karena Cloud Tasks menahan nama ±1 jam. `ALREADY_EXISTS` dianggap sukses.
- **Driver lokal di Postgres, bukan Redis,** agar dev/E2E tidak butuh emulator dan task tahan restart, dengan perilaku semirip mungkin dengan Cloud Tasks (nama, retensi 1 jam, retry, HTTP ke endpoint yang sama). Semua perhitungan waktunya di SQL (lihat Validasi).
- **Job berulang lewat Cloud Scheduler langsung**, bukan task berantai. Queue `ai-scheduled` hanya ada di driver lokal.
- **Satu Redis per layanan di VM** (v3, psikolog, AI) dan Postgres AI terpisah. Port data AI dipublikasikan di 5433/6380 dan dibatasi firewall VPC, karena port yang dipublikasikan Docker melewati firewall host.
- **Backup Postgres AI lewat Dokploy ke GCS + snapshot disk**, tanpa HA/PITR (risiko diterima untuk tahap awal). Pindah ke Cloud SQL tetap mungkin tanpa perubahan kode.

## Validasi

- gateway: `lint:check` 0 masalah, `typecheck` bersih, **273/273 unit test** (39 suite), `build` OK, termasuk setelah perubahan tracing.
- **E2E penuh: 208 PASS, 0 FAIL** pada 6 skenario (`e2e/run.sh`), termasuk restart semua gateway di tengah sesi. Driver `local` dipakai. E2E dijalankan sebelum perubahan allow-list tracing (hanya daftar string; unit test tracing lulus sesudahnya).
- Temuan saat E2E: driver lokal awalnya langsung menembakkan timer. Prisma (adapter-pg) menulis `Date` tanpa offset, sedangkan Postgres lokal ber-zona Asia/Makassar, sehingga `run_at` tersimpan 8 jam lebih awal daripada `now()`. Perbaikannya: semua perhitungan waktu driver di SQL (`to_timestamp`, `now()`, `make_interval`). Dokumen topologi mewajibkan Postgres AI ber-zona UTC.
- deeptalk-web-v2: `pnpm build` dengan `output: "standalone"` OK. Server standalone dijalankan seperti tahap runner (`HOSTNAME=0.0.0.0`, cookie jar): beranda 200, aset `/_next/static` 200, `/teman-ai/bantuan` 200. Dengan `HOSTNAME=127.0.0.1` terjadi loop 307; karena itu `0.0.0.0` dipasang di image.
- v3: merge `feat/ai-phase-1` ke `deploy/prod` dicek bersih tanpa konflik, tanpa mengganti checkout pengguna.
- Belum divalidasi: driver `cloud` terhadap Cloud Tasks sungguhan (hanya klien tiruan), image Docker web, semua langkah `gcloud`/Dokploy di dokumen.

## Blocker

- [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md) — diperbarui: VM Dokploy, queue Cloud Tasks, job Scheduler; Cloud SQL/Memorystore tidak dipakai lagi.
- [tooling-lokal-terraform-docker](../blockers/tooling-lokal-terraform-docker.md) — diperbarui: image web belum di-build.
- [uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md) — diperbarui: merge modul AI v3 ke `deploy/prod` menunggu review pemilik v3.

## Follow-up

- Modul Terraform `network`, `dokploy-vm`, `tasks`, `scheduler`, `cloud-run` sebelum staging (`infra/README.md`).
- Image atau job untuk `content:seed` di Cloud Run (sekarang lewat tunnel IAP dari laptop).
- Merge `feat/ai-phase-1` ke `deploy/prod` v3 setelah review.
- Bila v3/psikolog-service sudah berjalan di host lain: rencana cutover database (topologi §10).
- Prod: SSL Postgres, pertimbangkan WAL archiving atau Cloud SQL bila RPO 6 jam tidak cukup.
- Empat bug kecil Phase 8 yang dilaporkan sebelumnya (label tinjauan instrumen, race submit ganda, ujung grafik check-in, rentang skor grafik skrining) masih terbuka.

## Rekap Status

- **Selesai:** 17/19
- **Belum:**
  - `docker build` image web — Docker tidak terpasang (tooling)
  - Pembuatan dan uji infrastruktur di GCP — terblokir `lingkungan-gcp-dev`
- **Status task:** 🟨 Sebagian — semua perubahan repo dan dokumentasi selesai dan terverifikasi lokal; yang tersisa butuh Docker dan proyek GCP.
