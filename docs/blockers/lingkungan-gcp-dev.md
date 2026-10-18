# Lingkungan GCP `dev` Belum Ada (Phase 0)

**Status:** `OPEN`
**Dibuka:** 2026-10-08 · **Diselesaikan:** —
**Jenis:** akses
**Pemilik penyelesaian:** Wildan (infrastruktur), Pak Novri (Q2), Wildan (Q7)
**Memblokir:** exit criteria Phase 1 #1 dan #3 di `dev`; uji Cloud KMS, ID token Cloud Run, Vertex AI/Gemini, dan pipeline Cloud Build; Phase 2–3: latensi L2, context caching, gerbang evaluasi di pipeline, tier Pro handoff, Cloud Scheduler pengingat, alur Rani di `staging`
**Muncul di task:** [20261008-phase-1-fondasi-platform.md](../tasks/20261008-phase-1-fondasi-platform.md), [20261010-phase-2-3-percakapan-keamanan-output.md](../tasks/20261010-phase-2-3-percakapan-keamanan-output.md)

## Masalah

Phase 1 dikerjakan sebelum Phase 0 selesai. Belum ada proyek GCP (`dev`/`staging`/`prod`), VM Dokploy (Postgres AI, Redis), Cloud Tasks, KMS, Artifact Registry, maupun Cloud Run, dan mesin pengembangan tidak punya `gcloud` maupun Application Default Credentials. Model Gemini dan endpoint regionalnya (Q7) juga belum diputuskan.

## Dampak

- Exit criteria #1 ("satu percakapan dari web dan app ke **Gemini** … di `dev`, dua instance gateway") belum bisa dicapai. Secara lokal sudah dibuktikan dengan model lokal (`MODEL_PROVIDER=local`).
- `KmsKeyProvider` hanya diuji dengan KMS tiruan; enkripsi dengan Cloud KMS asli belum pernah berjalan.
- Pemanggilan agent dengan ID token (`AGENT_AUTH=id_token`) belum pernah berjalan.
- `cloudbuild/*.yaml` dan Terraform belum pernah dijalankan.
- Latihan deploy (exit criteria #3) baru dibuktikan secara lokal dengan SIGTERM, belum dengan deploy Cloud Run sungguhan.
- Phase 2–3: latensi L2 (Gemini Flash) terhadap `SAFETY_TIMEOUT_MS`, context caching (`App(context_cache_config)`), kualitas klasifikasi L2 dan draft handoff tier Pro, `cloudbuild/promote.yaml` (gerbang `eval:l1` + `evals.safety`), dan job Cloud Scheduler `routine-reminders` belum pernah berjalan.

## Yang sudah dicoba / diketahui

- Seluruh jalur kode tersedia dengan fallback lokal yang ditolak di production: `MESSAGE_LOCAL_KEY`, `AGENT_AUTH=none`, `MODEL_PROVIDER=local`.
- Uji integrasi lokal (dua instance gateway, Redis, Postgres, agent, issuer token dari kode v3) lulus. Lihat bagian Validasi di recap task.

## Yang dibutuhkan untuk lepas

- [ ] Keputusan Q2 (hosting GCP) — praktis terjawab oleh topologi 15 Okt (semua layanan di proyek GCP yang sama: Cloud Run + VM GCE/Dokploy); konfirmasi formal oleh pemilik Q2. Q7 (model + endpoint) diputuskan 15 Okt 2026: `gemini-4-argon` di `us`.
- [ ] Proyek GCP `dev` dengan billing, region `asia-southeast2`, API aktif (`infra/modules/project-services`).
- [ ] VM GCE + Dokploy dengan service Postgres AI (terpisah, `timezone=UTC`, backup ke GCS) dan Redis (password), hanya IP internal — [topologi deployment](../../../docs/deeptalk-ai/topologi-deployment-151026.md).
- [ ] Queue Cloud Tasks (`ai-session-timers`, `ai-outbox`, `ai-lifecycle`, `ai-evals`) dan job Cloud Scheduler (`outbox-sweep`, `account-sync`, `retention`, `routine-reminders`); gateway dengan `TASKS_DRIVER=cloud`. Driver Cloud Tasks hanya diuji dengan klien tiruan (unit test); E2E memakai driver lokal.
- [ ] Modul Terraform: network + firewall ke VM, Direct VPC egress gateway, KMS (key `messages`), Secret Manager, Artifact Registry, Cloud Run (gateway ≥ 2 instance, session affinity, timeout 3600 detik; agent privat dengan gateway SA sebagai satu-satunya invoker), Cloud Run Job `gateway-migrate`.
- [ ] Trigger Cloud Build untuk `cloudbuild/gateway.yaml` dan `cloudbuild/agent.yaml`.
- [ ] Jalankan `gateway/scripts/smoke-chat.mjs` terhadap dua instance di `dev` dan ulangi latihan deploy.
- [ ] Phase 2–3: ukur latensi L2 dan sesuaikan `SAFETY_TIMEOUT_MS`; verifikasi cache hit context caching; jalankan `evals.safety` dengan Gemini; Cloud Scheduler (tiap 5 menit) → `POST /v1/internal/scheduler/routine-reminders` dengan `SCHEDULER_TOKEN` dari Secret Manager.

## Opsi dan usulan

| Opsi | Konsekuensi |
|---|---|
| Selesaikan Phase 0 lalu deploy `dev` | Exit criteria Phase 1 bisa dinyatakan selesai |
| Lanjut Phase 2 tanpa `dev` | Risiko integrasi menumpuk; latensi L2 dan perilaku Cloud Run belum terukur |

**Usulan default:** selesaikan Phase 0 sebelum mulai Phase 2.

## Riwayat

- 2026-10-08 — dibuka dari task Phase 1.
- 2026-10-10 — cakupan diperluas oleh task Phase 2–3 (L2, context caching, gerbang evaluasi, tier Pro, Cloud Scheduler).
- 2026-10-11 — task Phase 6: apply `infra/modules/monitoring` (SLO, alert, dashboard, anggaran), tracing OTLP ke Cloud Trace (`TRACING_EXPORTER=otlp`), uji beban `staging` dengan Gemini, uji restore Cloud SQL (kini Postgres AI di VM, [runbook](../runbooks/restore-postgres-ai.md)), pipeline `promote.yaml` dengan `persona-gate`.
- 2026-10-11 — task Phase 4–5: draft Persona Card (tier Pro) dan evaluasi persona baru diuji dengan model lokal. Job sinkronisasi akun dan retensi memakai BullMQ (tidak butuh Cloud Scheduler).
- 2026-10-14 — task Phase 7: tahap 7.1–7.4 diubah lewat env v3 `prod` (`AI_ROLLOUT_MODE`, `AI_ROLLOUT_PERCENT`, `AI_ALLOWED_USER_IDS`) dan butuh lingkungan `prod` deeptalk-ai serta alert/on-call aktif.
- 2026-10-14 — task Phase 9: Sensitive Data Protection (`@google-cloud/dlp`, `DATASET_DEID=dlp`, lokasi `asia-southeast2`) belum pernah dipanggil; bucket terbatas untuk ekstraksi/ekspor belum ada.
- 2026-10-15 — panduan setup GCP + Gemini Enterprise Agent Platform dengan `gemini-4-argon`: `docs/deeptalk-ai/setup-gcp-agent-platform-argon.md` (root logos-dev). Temuan: Argon hanya `global`/`us`/`eu` (tidak ada endpoint Gemini di Jakarta), explicit context caching tidak didukung, `google-genai` ≥ 2.30.1 — butuh perubahan kode agent dan keputusan Q7 (lokasi pemrosesan).
- 2026-10-15 — **Q7 diputuskan (Wildan):** semua layanan Gemini/Agent Platform di region `us`, model `gemini-4-argon` untuk tier chat dan dokumen; infrastruktur dan data tersimpan tetap di `asia-southeast2`. Agent disesuaikan ([recap](../tasks/20261015-model-gemini-4-argon-region-us.md)): `google-genai` 2.31.0, explicit caching off, thinking per tier, lokasi `us` wajib di production. Q2 (hosting GCP) masih terbuka secara formal.
- 2026-10-15 — **Topologi deployment tahap awal (Wildan):** gateway + agent di Cloud Run; web, v3, psikolog-service, semua database, dan Redis di VM GCE + Dokploy (proyek/VPC sama); antrian gateway pindah dari BullMQ ke Cloud Tasks ([recap](../tasks/20261015-topologi-deployment-cloud-tasks.md)). Cloud SQL dan Memorystore tidak lagi dipakai; "job BullMQ" di catatan 2026-10-11 kini job Cloud Scheduler.
- 2026-10-15 — proyek GCP trial `deeptalk-496008` + service account `agent-run`/`gateway-run` (key lokal di `.creds/`, diabaikan git). Argon `us` terpanggil dari laptop; `evals.smoke_model` lulus semua (tier chat/dokumen, L2, router, satu giliran) dengan `SAFETY_TIMEOUT_MS=6000`. Temuan latensi L2: [latensi-l2-argon](latensi-l2-argon.md). Cloud Run, KMS, Cloud Tasks belum dibuat.

## Penyelesaian

—
- 2026-10-16 — cek kesiapan deploy Cloud Run ([recap](../tasks/20261016-kesiapan-deploy-cloud-run.md)): image gateway/agent tervalidasi lewat simulasi runtime; logger dev diperbaiki agar gateway `dev` bisa jalan di Cloud Run. Masih menunggu: merge + deploy v3 `feat/ai-phase-1`, pembuatan resource GCP (AR, KMS, Secret Manager, Cloud Tasks/Scheduler, VPC + VM Postgres/Redis, Cloud Run).
