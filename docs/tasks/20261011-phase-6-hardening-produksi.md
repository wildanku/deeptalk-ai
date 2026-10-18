# Phase 6 — Hardening Produksi

**Tanggal:** 2026-10-11
**Phase:** Phase 6 — Hardening Produksi ([03-phase.md](../03-phase.md))
**Komponen:** gateway, agent, infra, cloudbuild, e2e, docs, `deeptalk-web-v2`, `deeptalk-app-v2`, `psikolog-deeptalk-dashboard`
**Recap terkait:** [20261010-phase-4-5-consent-data-portal-psikolog.md](20261010-phase-4-5-consent-data-portal-psikolog.md)

## Tujuan

Membuat layanan siap menerima pengguna nyata: terukur (SLO, dashboard, alert, tracing), teruji beban, ditinjau keamanannya, punya runbook untuk setiap insiden, biaya terkendali, gerbang evaluasi di pipeline promosi, dan siap untuk kebijakan toko aplikasi.

Lingkungan GCP belum ada (Phase 0), jadi bagian infrastruktur ditulis sebagai kode dan diuji sejauh mungkin secara lokal. Latihan runbook dengan orang menunggu penunjukan on-call (Q12) dan kebijakan tindak lanjut krisis (Q5).

## Daftar Pekerjaan

### Observabilitas dan SLO
- [x] Metrik SLO di gateway: `ai_turn.first_token_ms` (token pertama yang **tampil**, setelah safety gate), `l2_verdict`, `crisis_detected` / `crisis_protocol_sent`, token per giliran, `session_ended` (biaya per sesi), `message_reported`
- [x] Tracing OpenTelemetry gateway (OTLP ke Cloud Trace; span `ai.turn`; HTTP, undici, Nest) dengan allow-list atribut dan kata rute; agent: korelasi log lewat `traceparent` tanpa ekspor span (span ADK memuat prompt)
- [ ] Modul Terraform `monitoring`: log-based metrics, SLO ketersediaan, 7 alert (krisis, krisis tanpa protokol, error, timeout L2, token pertama p95, gateway mati, burn rate), dashboard, anggaran — ditulis dan dipasang di `envs/*`; belum `terraform validate` ([tooling-lokal-terraform-docker](../blockers/tooling-lokal-terraform-docker.md)) dan belum di-apply (terblokir: [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md))
- [x] Dokumen SLO [`docs/slo.md`](../slo.md)

### Runbook
- [x] Runbook insiden krisis, gangguan Vertex AI, respons tidak aman, kebocoran data, restore Cloud SQL, pedoman on-call ([`docs/runbooks/`](../runbooks/README.md))
- [x] Simulasi teknis lokal: krisis L1/L2 dan sebelum consent (E2E `phase2-3`, `phase4-5`), agent mati + restart gateway (`resilience`), nonaktifkan persona dan laporan respons (`phase4-5`)
- [ ] Latihan dengan on-call engineer dan psikolog — terblokir: [keputusan-q5-q12-oncall-krisis](../blockers/keputusan-q5-q12-oncall-krisis.md)

### Uji beban
- [x] `e2e/load.mjs` (`./run.sh load`): N pengguna × T giliran di dua gateway; token pertama p50/p95/p99, waktu balasan, error, krisis → protokol
- [x] Baseline lokal 100 pengguna × 5 giliran: semua SLO lulus
- [ ] Uji beban di `staging` dengan Gemini sesuai target tahap rollout pertama (Q3) — terblokir: [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md)

### Keamanan
- [x] Tinjauan keamanan internal (dokumen tinjauan disimpan internal, tidak dipublikasikan); temuan di layanan AI diperbaiki: tombstone akun terhapus, rate limit REST, sanitasi trace, pool starvation, dependensi gateway, patch Next.js di web
- [x] Audit dependensi keenam repo (pnpm/npm lewat registry HTTPS, OSV untuk agent) — gateway dan agent bersih; temuan di repo lain diserahkan ke pemilik masing-masing repo (dicatat internal)
- [ ] Uji penetrasi eksternal — belum dijadwalkan (sebelum rilis publik)

### Backup
- [x] Prosedur backup/PITR dan restore ke instance baru + sinkron ulang akun ([runbook](../runbooks/restore-postgres-ai.md) — dulu `restore-cloud-sql.md`; diganti 2026-10-15 untuk topologi VM)
- [ ] Uji restore di GCP — terblokir: [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md)

### Biaya
- [x] `usage` token generate persona dari agent → `ai_turn` dan total per sesi (`ai_sessions.turns`, `tokens_input`, `tokens_output`, metrik `session_ended`)
- [ ] Alert anggaran bulanan — `google_billing_budget` di modul monitoring; belum di-apply (terblokir: [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md))

### Pipeline
- [x] `persona-gate` di `cloudbuild/promote.yaml` (`pnpm run eval:personas`): setiap persona aktif punya versi approved dengan evaluasi lengkap yang semuanya aman — diuji: gagal benar pada persona DRAFT lokal

### Toko aplikasi
- [x] Tinjauan kebijakan App Store (5.1.2(i), 5.1.1, 1.4.1) dan Google Play (AI-Generated Content, Health apps, User Data, Data safety) — [`docs/rilis/kebijakan-toko-aplikasi.md`](../rilis/kebijakan-toko-aplikasi.md)
- [ ] "Laporkan respons AI": API dan tinjauan dashboard diuji E2E; tombol di web dan app dibangun, belum diuji ke v3 (terblokir: [uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md))

### Verifikasi
- [x] Unit test, E2E lokal (termasuk laporan respons dan tombstone), regresi Phase 2–5

### Dokumentasi
- [x] 02, 03, AGENT.md, skill gateway/agent, README e2e/infra, blocker, status web

### Exit criteria
- [ ] Semua SLO terpenuhi di `staging` selama uji beban — terblokir: [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md)
- [ ] Tidak ada temuan keamanan kritis atau tinggi yang terbuka — layanan AI bersih; repo lain ditangani pemilik masing-masing repo (dicatat internal)
- [ ] On-call engineer dan psikolog sudah ditunjuk dan sudah berlatih runbook krisis — terblokir: [keputusan-q5-q12-oncall-krisis](../blockers/keputusan-q5-q12-oncall-krisis.md)

## File yang Diubah

**deeptalk-ai/gateway**
- `prisma/schema.prisma`, `prisma/migrations/*_phase6_usage_reports/` — `ai_sessions.turns/tokens_*`, `ai_message_reports` (additive).
- `src/observability/tracing.ts` (+spec, baru), `src/main.ts` (impor pertama) — tracing.
- `src/agent-client/agent-events.ts` (+spec agent-client) — `usage` di `done`.
- `src/realtime/conversation.service.ts` (+spec) — metrik SLO, token pertama yang tampil, `addUsage`, `crisis_protocol_sent`.
- `src/realtime/turn.service.ts` — span `ai.turn`, `crisis_protocol_sent` di gerbang.
- `src/safety/safety.service.ts` — `crisis_detected`.
- `src/sessions/sessions.service.ts` — `addUsage`, `session_ended`, consent dibaca sebelum transaksi.
- `src/consents/consents.service.ts` — `trainingActive` tanpa parameter transaksi.
- `src/reports/*` (baru, +spec) — laporan respons AI.
- `src/auth/ai-token-verifier.service.ts` (+spec) — tombstone akun; `src/lifecycle/lifecycle.service.ts` — menulis tombstone.
- `src/common/interceptors/rate-limit.interceptor.ts` (+spec, baru), `src/app.module.ts` — rate limit REST global.
- `src/database/prisma.service.ts` — `DATABASE_POOL_MAX`, `connectionTimeoutMillis`.
- `src/redis/redis.service.ts` — `exists`.
- `src/config/env.schema.ts`, `.env.example` — `TRACING_*`, `GOOGLE_CLOUD_PROJECT`, `REST_RATE_LIMIT_PER_MINUTE`, `DATABASE_POOL_MAX`.
- `scripts/check-persona-evals.ts` (baru) + `src/evals/persona-gate.spec.ts`, `package.json` (`eval:personas`, OpenTelemetry, `pnpm.overrides` `deepmerge-ts`/`mysql2`), `pnpm-lock.yaml`.

**deeptalk-ai/agent**
- `app/turn.py` — `usage` di `done`; `agents/local_llm.py` — perkiraan token lokal.
- `app/tracing.py` (baru), `app/logging.py`, `app/main.py` — korelasi trace di log.
- `tests/test_turn.py`, `tests/test_tracing.py` (baru).

**deeptalk-ai lainnya**
- `infra/modules/monitoring/*` (baru), `infra/envs/{dev,staging,prod}/main.tf`, `infra/README.md`.
- `cloudbuild/promote.yaml` — `persona-gate`.
- `e2e/load.mjs` (baru), `fake-v3.js` (`LOAD_USERS`), `stack.sh` (`GOOGLE_CLOUD_PROJECT` agent, reset laporan), `run.sh` (`load`), `phase4-5.mjs` (laporan, tombstone), `README.md`.
- `docs/slo.md`, `docs/runbooks/*`, `docs/rilis/kebijakan-toko-aplikasi.md` (baru); `docs/02-implementasi.md`, `docs/03-phase.md`, `docs/blockers/*`, `AGENT.md`, skill gateway/agent.

**deeptalk-web-v2** (branch `feat/ai-phase-1`) — `src/components/teman-ai/report-message.tsx` (baru), `teman-ai-chat.tsx`, `src/lib/api/ai.ts`, `src/lib/domain/ai.ts`; `package.json`/`pnpm-lock.yaml` (Next 16.3.5 → 16.3.8, `eslint-config-next` 16.3.8); `docs/phase/README.md`.

**deeptalk-app-v2** (branch `feat/ai-phase-1`) — `src/components/teman-ai/report-message.tsx` (baru), `src/app/teman-ai/index.tsx`, `src/lib/ai.ts`.

**psikolog-deeptalk-dashboard** (branch `feat/ai-phase-5`) — `app/(app)/teman-ai/keamanan/page.tsx` (tab Laporan respons), `features/teman-ai/{api,hooks,types}.ts`.

## Keputusan

- **Token pertama diukur saat tampil ke pengguna** (setelah safety gate melepas token), bukan saat token pertama tiba dari agent.
- **Agent tidak pernah mengekspor span:** ADK menaruh prompt dan output model di atribut span. Korelasi cukup lewat field trace Cloud Logging di log agent.
- **Sanitasi trace memakai allow-list kata rute**, bukan pola ID: uji dengan collector OTLP tiruan menunjukkan ID berbentuk bebas (`itest-a`, `PSY-TEST`, `BK-SAME`) lolos dari pola. Setelah allow-list: 0 kebocoran.
- **Exporter Cloud Trace khusus (`@google-cloud/opentelemetry-cloud-trace-exporter`) tidak dipakai** — deprecated dan diarsipkan setelah 30 Okt 2026; diganti OTLP ke `telemetry.googleapis.com` dengan header Google auth.
- **Tombstone akun terhapus** (1 jam > umur token AI) lebih sederhana dan lebih aman daripada daftar `jti` yang dicabut; Redis mati tidak mengunci semua pengguna (fail open dengan log), karena percakapan sudah berhenti tanpa Redis.
- **Stall ±26 detik di uji beban lokal bukan bug aplikasi:** semua proses (gateway, agent, v3 tiruan) diam bersamaan, jam monotonik agent tidak maju, dan `pmset -g log` menunjukkan Mac masuk *Maintenance Sleep* tepat pada jendela itu (03:39:49–03:40:16 +0800). Uji beban selanjutnya dijalankan dengan `caffeinate -i`. Investigasi itu juga menemukan risiko nyata (kueri pool di dalam transaksi), yang diperbaiki.
- **Laporan respons AI tanpa ID pengguna dan tanpa teks bebas;** teks balasan hanya untuk reviewer bila pengguna mengizinkan, dan hilang saat riwayat/akun dihapus. Memenuhi kebijakan Play (pelaporan di dalam app) tanpa menambah data pribadi.
- **Upgrade Next.js di web hanya patch** (16.3.5 → 16.3.8) karena kerentanan kritis yang memang terpapar. Perbaikan di repo lain diserahkan ke pemilik repo.
- **Override dependensi gateway** (`deepmerge-ts`, `mysql2`) hanya menyentuh CLI Prisma; diverifikasi generate, migrate status, seed, build, dan test.

## Validasi

- [x] gateway: `lint:check`, `typecheck`, `build`, `prisma validate`/`generate`/`migrate status` bersih; unit 202 lulus; e2e 2 lulus; `pnpm audit --prod` bersih.
- [x] agent: `ruff`, `mypy --strict` bersih; `pytest` 37 lulus; OSV: 69 paket, 0 kerentanan.
- [x] web: `tsc` bersih, lint hanya 2 warning lama, vitest 121 lulus, `pnpm build` lulus (termasuk `/opengraph-image`) setelah Next 16.3.8.
- [x] app: `tsc` tanpa error baru, `expo lint` hanya 2 error lama, `expo export --platform ios` lulus.
- [x] dashboard: `tsc`, `pnpm lint`, `pnpm build` lulus.
- [x] E2E lokal: `phase2-3`, `limits`, `resilience`, `phase4-5` lulus (140 cek), termasuk laporan respons dan tombstone; log tanpa teks percakapan (0 kecocokan).
- [x] Uji beban lokal (`caffeinate -i`, 100 pengguna × 5 giliran, dua gateway, model lokal): 500 giliran, 42 giliran/dtk, token pertama p50 ≈ 0,1 dtk / p95 254 ms / p99 296 ms, balasan p95 1,0 dtk, error 0%, krisis → protokol 50/50. Model lokal — bukan angka Gemini.
- [x] Tracing: dengan collector OTLP tiruan, span `ai.turn` dan HTTP terekspor; ID trace di log agent ditemukan di span gateway; 0 kemunculan teks percakapan, ID pengguna/psikolog/booking, query string, `url.full`.
- [x] `pnpm run eval:personas` terhadap DB lokal: gagal dengan benar (persona DRAFT aktif tanpa versi approved).
- [ ] `terraform validate`/`plan` modul monitoring — [tooling-lokal-terraform-docker](../blockers/tooling-lokal-terraform-docker.md).
- [ ] Apply monitoring, tracing ke Cloud Trace, uji beban `staging`, uji restore, `promote.yaml` — terblokir: [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md).
- [ ] Latihan runbook dengan orang — terblokir: [keputusan-q5-q12-oncall-krisis](../blockers/keputusan-q5-q12-oncall-krisis.md).

## Blocker

- [keputusan-q5-q12-oncall-krisis](../blockers/keputusan-q5-q12-oncall-krisis.md) — **baru**: on-call, kanal alert, latihan, tindak lanjut krisis.
- [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md) — diperbarui: apply monitoring, Cloud Trace, uji beban staging, restore, pipeline.
- [tooling-lokal-terraform-docker](../blockers/tooling-lokal-terraform-docker.md) — diperbarui: `terraform validate` modul monitoring.
- [teks-hukum-consent-privasi-dpia](../blockers/teks-hukum-consent-privasi-dpia.md) — diperbarui: teks consent wajib menyebut penyedia AI (App Store 5.1.2(i)); Data safety, Health apps declaration.

## Follow-up

- [ ] Review dan commit di keenam repo (belum ada commit).
- [ ] Uji penetrasi eksternal sebelum rilis publik.
- [ ] Re-enkripsi pesan bila kunci KMS dicurigai bocor (job belum ada; runbook kebocoran data langkah 4).
- [ ] Tanda tangan HMAC + timestamp untuk webhook v3 → gateway; batasi `/v1/internal/*` (Cloud Armor / layanan internal).
- [ ] Hitung token L2, kartu, router, ringkasan, dan handoff ke metrik biaya.
- [ ] Audit dependensi di CI semua repo (dengan registry HTTPS).

## Rekap Status

**Status:** ⛔ Terblokir
**Progres:** 15/25 item selesai

| Belum selesai | Alasan |
|---|---|
| Modul Terraform monitoring (validate/apply) | Terblokir: tooling-lokal-terraform-docker, lingkungan-gcp-dev |
| Latihan runbook dengan orang | Terblokir: keputusan-q5-q12-oncall-krisis |
| Uji beban `staging` | Terblokir: lingkungan-gcp-dev |
| Uji penetrasi eksternal | Belum: perlu penyedia dan jadwal |
| Uji restore Cloud SQL | Terblokir: lingkungan-gcp-dev |
| Alert anggaran | Terblokir: lingkungan-gcp-dev (kode ada) |
| "Laporkan respons AI" di UI web/app | Terblokir: uji-client-ke-v3-dev (API lulus E2E) |
| Exit: SLO di `staging` | Terblokir: lingkungan-gcp-dev |
| Exit: tidak ada temuan kritis/tinggi | Repo lain ditangani pemiliknya (layanan AI bersih) |
| Exit: on-call ditunjuk dan berlatih | Terblokir: keputusan-q5-q12-oncall-krisis |
