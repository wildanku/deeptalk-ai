---
name: gateway
description: Konvensi NestJS untuk deeptalk-ai/gateway — modul, Socket.IO namespace /ai, verifikasi token AI lewat JWKS, Prisma/Postgres, sesi/kuota/Cloud Tasks, safety L1, validasi output terstruktur, klien v3 dan agent. Muat untuk pekerjaan apa pun di gateway/ (scaffold, modul, controller, service, gateway socket, DTO, guard, migrasi, spec) atau saat menjalankan build/lint/test gateway.
metadata:
  type: project
---

# Gateway (deeptalk-ai)

Pintu masuk client: Socket.IO + REST, sesi, kuota, consent, penyimpanan percakapan, routine, handoff, konten klinis, API psikolog. Acuan lengkap: `docs/02-implementasi.md` §5–§9 dan §11–§12.

> Phase 1 (2026-10-08): auth JWKS, `/ai` dengan room per pengguna, alur satu giliran (`TurnService`), enkripsi pesan, sesi minimal, riwayat REST, drain saat shutdown. Modul `safety/`, `routines/`, `handoffs/`, `assessments/`, `consents/`, `content/`, `evals/`, `lifecycle/`, `v3-client/` masih kosong.
>
> Phase 2–3 (2026-10-10): konten berversi, persona + router, safety L1 + gate L2/L3, kuota/waktu aktif/timer (kini Cloud Tasks), outbox, memori, routine + pengingat, asesmen, handoff, endpoint internal. `consents/`, `evals/`, `lifecycle/` masih kosong (Phase 4–5).
>
> Phase 4–5 (2026-10-11): `consents/` (consent berversi, gerbang usia, `OnboardingController` di `RealtimeModule`), `lifecycle/` (hapus/merge akun, feed tarik dari v3, hapus riwayat, retensi), `evals/` (persona workspace, evaluasi, `PsikologController`), `content/review.*` dan `safety/safety-review.controller.ts` (reviewer klinis), `auth/staff-role*` (`clinical_reviewer`). Recap: `docs/tasks/20261010-phase-4-5-consent-data-portal-psikolog.md`. Recap: `docs/tasks/20261010-phase-2-3-percakapan-keamanan-output.md`.

## Stack dan library

| Kebutuhan | Library |
|---|---|
| Framework | NestJS 11 (`@nestjs/*`), Express 5 |
| Database | Prisma 7 + `@prisma/adapter-pg`; client di `src/generated/prisma` (di-generate, diabaikan git) |
| Realtime | `@nestjs/platform-socket.io` + `@socket.io/redis-adapter` + `redis` |
| Antrian/timer | `@google-cloud/tasks` (production) / driver Postgres `ai_local_tasks` (lokal, E2E) — tanpa BullMQ |
| Token AI (ES256/JWKS) | `jose` (`createRemoteJWKSet`, `jwtVerify`) |
| Enkripsi isi pesan | `@google-cloud/kms` |
| Logging | `nestjs-pino` + `pino` (dev: `pino-pretty`) |
| Validasi | zod (env), `class-validator` + `class-transformer` (DTO) |
| ID | `uuidv7` |
| Keamanan HTTP | `helmet` |

Package manager **pnpm** saja. Pola boleh disalin dari `deeptalk-api-v3` (`src/modules/chat`, `room-close.processor.ts`, envelope `{ success, message?, data }`); `cors.ts`, `envelope.ts`, `response.interceptor.ts`, `http-exception.filter.ts`, `redis-io.adapter.ts`, dan `prisma.service.ts` sudah disalin dari sana.

## Peta file

| Path | Isi |
|---|---|
| `src/main.ts` | helmet, CORS, Redis IO adapter, prefix `v1`, ValidationPipe, filter, interceptor |
| `src/app.module.ts` | Config (zod), Logger, semua modul |
| `src/config/env.schema.ts` | Env 02 §11.1 + parameter sesi §6.3; string kosong = tidak diset; variabel integrasi wajib di `production` |
| `src/observability/logger.ts` | `REDACT_PATHS`, format `severity` Cloud Logging, URL tanpa query |
| `src/common/` | envelope, filter error (log nama/kode saja), CORS |
| `src/database/` | `PrismaService` (global) |
| `src/tasks/` | `TASK_QUEUE` (`enqueue(queue, {name, payload, at?, deadlineSeconds?})`) + `TaskHandlers` (`register` handler queue, `registerJob` job terjadwal). `TASKS_DRIVER=cloud` → `CloudTasksQueue` (task HTTP bernama ke `POST /v1/internal/tasks/:queue`, header `x-tasks-token`; ALREADY_EXISTS = sukses); `local` → `LocalTaskQueue` (Postgres, `SKIP LOCKED`, nama tetap terpakai 1 jam seperti Cloud Tasks) + `LocalScheduler` (pengganti Cloud Scheduler). Cloud Scheduler → `POST /v1/internal/scheduler/jobs/:job` (`outbox-sweep`, `account-sync`, `retention`) |
| `src/auth/` | `AiTokenVerifier` (jose, ES256, `iss`/`aud`/`kid`), `AiAuthGuard` + `@AiRoles` + `@CurrentPrincipal`, `testing.ts` (penerbit token untuk spec) |
| `src/realtime/ai.gateway.ts` | Handshake (`auth.token` atau header Bearer), room `user:<id>`, `auth.refresh`, putus saat `exp`, `message.send`; psikolog ditolak; shutdown memutus socket **lokal** saja (`server.local`) |
| `src/realtime/turn.service.ts` | Satu giliran: validasi (≤ 2.000 karakter) → rate limit → L1 → sesi/kuota (`quota.exhausted` setelah L1+L2) → idempotensi `client_message_id` → lock Redis per sesi (krisis L1 lewat tanpa lock) → `ConversationService` |
| `src/realtime/conversation.service.ts` | Giliran agent: konteks (persona, pengetahuan, memori, state, katalog) → gate token sampai event `safety` → protokol/risiko → simpan → **lepas lock** → `ai.done` → kartu; `crisisTurn` tanpa agent |
| `src/realtime/session-state.service.ts` | Pilihan persona sebelum pesan pertama (Redis), `session.start`/`persona.switch`, `session.state` |
| `src/sessions/` | `openForMessage` (kunci `ai_user_state`, kuota, sesi krisis tidak dihitung), `quota.ts`, timer Cloud Tasks (`session-timers.service.ts`, nama task memuat waktu jatuh tempo), memori (`memory.service.ts`), `history.ts` (`protocol` → assistant), REST sesi/pengaturan |
| `src/content/` | Konten berversi (`approved`, atau draft bila `CONTENT_ALLOW_DRAFT` di non-production), skema zod per jenis, `GET /v1/personas`, `GET /v1/help` (publik) |
| `src/safety/` | `l1.ts` (normalisasi slang/angka/klitik, gap `...`), `risk.ts` (risiko lengket), `SafetyService`, `AlertService` (tanpa isi), `fallback.ts` (safety floor engineering bila konten tidak ada) |
| `src/outbox/` | Outbox transaksional + task `ai-outbox` (nama `outbox-<id>-a<percobaan>`; job `outbox-sweep` tiap menit): ringkasan sesi, notifikasi v3 |
| `src/v3-client/` | Direktori psikolog, katalog/hasil asesmen, booking, notifikasi (header `x-ai-service-token`; cache Redis 5 menit) |
| `src/routines/` | `routine-rules.ts` (validasi kartu), CRUD/log/ringkasan mingguan, `RemindersService` |
| `src/assessments/`, `src/handoffs/` | Katalog ∩ pemetaan; handoff (draft terenkripsi, hapus bagian, tautan booking, konfirmasi ulang, baca oleh psikolog yang ditugaskan) + `internal.controller.ts` (v3 dan Cloud Scheduler) |
| `src/common/emitter/` | `UserEmitter`: emit ke room `user:<id>` dari service non-gateway; `disconnect(userId)` |
| `src/consents/` | `ConsentsService` (riwayat append-only, `min_accepted_version`, tawaran consent pelatihan), `AgeService` (birth_date v3, `AI_MIN_AGE`, fallback `age_band`), `OnboardingService.gate` (dipakai `TurnService` sebelum sesi baru), `OnboardingController` (`/me/onboarding`, `/me/consents`) |
| `src/lifecycle/` | `LifecycleService` (hapus/merge akun idempoten, kunci sesi dulu, sapuan ulang 2 menit; hapus riwayat), `AccountSyncService` (feed `account-events` v3, kursor + overlap 100), `RetentionService`, queue `ai-lifecycle` + job `account-sync`/`retention` (didaftarkan di `lifecycle.module.ts`) |
| `src/evals/` | `PersonaWorkspaceService` (kuesioner, studi kasus, draft, koreksi, setujui, nonaktifkan; `status` hanya-baca untuk card Beranda, tahapan di `persona-status.ts`), `EvalRunsService` (task `ai-evals`, `deadlineSeconds` 1800, rating, `readiness`), `PsikologController` (`/psikolog/*`) |
| `src/content/review.*` | Kurasi konten klinis (`/review/content`): draft → in_review → approved/rejected; penyetuju ≠ penulis; seed `seed:*` tidak bisa disetujui |
| `src/auth/staff-role*` | `StaffRolesService`, `StaffRoleGuard` + `@RequireStaffRole('clinical_reviewer')` |
| `src/auth/ai-token-verifier.service.ts` | Juga menolak token akun yang baru dihapus/di-merge (`account-gone:<id>` di Redis, 1 jam) |
| `src/observability/tracing.ts` | OpenTelemetry (impor pertama di `main.ts`): OTLP ke Cloud Trace, `SanitizingExporter` (allow-list atribut, kata rute; segmen lain → `:id`), `tracer` untuk span `ai.turn` |
| `src/common/interceptors/rate-limit.interceptor.ts` | Rate limit REST per principal (`REST_RATE_LIMIT_PER_MINUTE`), global |
| `src/assessments/referrals.*`, `src/impact/` | Rujukan asesmen (ditawarkan/dibuka) dan `GET /review/impact` (Konsep §8, agregat) |
| `scripts/rollout-readiness.ts` | `pnpm run rollout:readiness` — syarat naik tahap peluncuran |
| `src/instruments/` | Cek diri (Phase 8): `scoring.ts` (validasi jawaban, skor sum/mean, kunci terbalik, rentang, dimensi, butir keamanan), `InstrumentsService` (gerbang onboarding, satu entri per hari lokal, interval, jawaban+hasil terenkripsi AAD = ID baris, protokol + kejadian `layer = instrument`) |
| `src/content/coverage*`, `src/realtime/persona-pool.ts` | `GET /topics`, `GET /review/coverage` (Phase 8); kandidat router Quick Chat maks. 12, paling jarang dipakai dulu, bergilir per topik |
| `scripts/knowledge-budget.ts` | `pnpm run knowledge:budget` — ambang materi prompt → RAG (02 §7.3), juga dicek `rollout:readiness` |
| `src/datasets/` | Phase 9: `gates.ts` (register `ai_data_gates`, `assertOpen`), `deid.ts` (`DlpDeidentifier` di `DLP_LOCATION`, `LocalDeidentifier` dev), `DatasetsService` (collect/import/review/export, cek consent ulang), `PsikologDataConsentService` (addendum), `withdraw.ts` (dipakai consents + lifecycle), `datasets-cli.module.ts` (konteks Nest minimal untuk `scripts/dataset.ts`) |
| `src/reports/` | "Laporkan respons AI": `POST /messages/:id/report`, `/review/reports` |
| `scripts/check-persona-evals.ts` | `pnpm run eval:personas` — gerbang persona di `promote.yaml` |
| `src/messages/` | `MessagesService` (idempoten, riwayat terdekripsi), `crypto/` (AES-256-GCM, AAD = ID baris, `KmsKeyProvider`/`LocalKeyProvider`) |
| `src/agent-client/` | Klien SSE (`eventsource-parser`), ID token Cloud Run bila `AGENT_AUTH=id_token` |
| `src/redis/` | `tryLock`/`release` (compare-and-delete), `hit` (rate limit), JSON get/set |
| `src/common/drain/` | `DrainService`: giliran yang berjalan diselesaikan sebelum Prisma/Redis ditutup saat SIGTERM |
| `src/observability/metrics.service.ts` | Metrik sebagai log terstruktur (`metric`), tanpa konten/ID pengguna |
| `src/health/` | `GET /v1/health` |
| `prisma/schema.prisma` + `migrations/` | `init` (Phase 1) + `phase2_3_content_safety_routines_handoffs` (additive) |
| `scripts/smoke-chat.mjs` | Smoke test satu giliran lintas dua instance |
| `scripts/seed-content.ts`, `scripts/eval-l1.ts` | `content:seed` (append-only) dan `eval:l1` (gerbang evaluasi) |

Catatan tooling:
- `jose` dan `eventsource-parser` hanya ESM. Node 24 me-`require` keduanya; Jest men-transpile-nya lewat `transformIgnorePatterns` + `tsconfig.jest.json` (`allowJs`).
- `tsconfig.build.json` menyimpan `tsBuildInfoFile` di `dist/`. Jangan dipindah: `deleteOutDir` + tsbuildinfo di luar `dist/` membuat build kedua tidak menghasilkan apa pun.
- Spec memakai `testConfig()` (`src/config/testing.ts`) agar default env sama dengan runtime.

## Perintah

| Tujuan | Perintah (di `gateway/`) |
|---|---|
| Install (+ `prisma generate`) | `pnpm install` |
| Dev (`:8080`) | `pnpm run start:dev` |
| Lint | `pnpm run lint` (fix) / `pnpm run lint:check` |
| Typecheck | `pnpm run typecheck` |
| Unit test | `pnpm run test` |
| E2E | `pnpm run test:e2e` |
| Build | `pnpm run build` |
| Validasi skema | `pnpm exec prisma validate` |
| Generate resource | `pnpm exec nest generate <schematic> <name>` |
| Migrasi lokal | `pnpm exec prisma migrate dev` — **hanya** terhadap database lokal |
| Migrasi dev/staging/prod | `pnpm exec prisma migrate deploy` — hanya lewat pipeline |
| Seed konten `content/` | `pnpm run content:seed` |
| Vonis L1 untuk gerbang evaluasi | `pnpm run eval:l1 <cases.json> <out.json>` |
| Peran reviewer klinis | `pnpm run roles:grant <psikolog_id> clinical_reviewer --by <siapa>` |

Jalankan `lint`, `typecheck`, `test`, `test:e2e`, dan `build` sebelum menganggap perubahan selesai, lalu catat hasilnya di recap (skill **task-recap**).

## Struktur modul (02 §6.1)

`config/`, `auth/`, `realtime/`, `sessions/`, `messages/`, `agent-client/`, `safety/`, `routines/`, `handoffs/`, `assessments/`, `consents/`, `content/`, `evals/`, `lifecycle/`, `v3-client/`, `observability/`, `health/`. Satu tanggung jawab per modul; jangan membuat god-service. Constructor injection saja. Spec `.spec.ts` berdampingan dengan file yang diubah.

## Aturan

### Auth
- Token AI: JWT ES256 dari v3, diverifikasi lewat JWKS (`AI_JWKS_URL`) yang di-cache. Tolak bila `iss` ≠ `deeptalk-api`, `aud` ≠ `deeptalk-ai`, kedaluwarsa, atau `kid` tidak dikenal. Gateway tidak pernah memegang kunci privat.
- Verifikasi berlaku di REST (`AiAuthGuard`), handshake socket, dan `auth.refresh`. Socket diputus saat `exp` tercapai kecuali token sudah diperbarui.
- Panggilan ke v3 internal memakai header `x-ai-service-token`. Webhook masuk dari v3 memakai `INBOUND_WEBHOOK_TOKEN` dan idempoten lewat `ai_inbound_events`.
- Ke agent: Cloud Run ID token (IAM invoker). Client tidak pernah memanggil agent.

### Realtime dan sesi
- Namespace `/ai`, `transports: ['websocket']`, Redis adapter. Tidak ada state di memori instance — semua harus aman multi-instance dan restart.
- Daftar event dan payload: 02 §6.2. Jangan menambah/mengubah event tanpa memperbarui 02 dan client (web + app).
- Pembuatan sesi + cek kuota dalam satu transaksi dengan `SELECT … FOR UPDATE` pada `ai_user_state`.
- Timer idle/wall-clock = task Cloud Tasks tertunda, idempoten, dijadwalkan ulang setiap aktivitas. Nama task memuat waktu jatuh tempo: Cloud Tasks menolak nama yang sama selama ±1 jam setelah task selesai/dihapus (driver lokal meniru ini), jadi nama tanpa waktu jatuh tempo membuat penjadwalan ulang hilang. Task yang datang terlalu awal menjadwalkan ulang dirinya ke `due+1000`, bukan nama yang sama. Handler harus idempoten: Cloud Tasks menjamin *at-least-once*.
- Jangan memakai `this.prisma` (pool) di dalam callback `$transaction` interaktif — bisa menghabiskan pool di bawah beban; baca dulu sebelum transaksi.
- Metrik SLO: `ai_turn` (`first_token_ms` = token pertama yang tampil), `l2_verdict`, `crisis_detected`/`crisis_protocol_sent`, `session_ended`; tambah metrik baru juga ke `infra/modules/monitoring` dan `docs/slo.md`.
- Gerbang usia + consent hanya sebelum sesi baru (`OnboardingService.gate`); pesan yang ditolak tidak disimpan, tetapi L1 `crisis` tetap menerima protokol.
- Lock giliran dilepas setelah balasan/protokol tersimpan dan **sebelum** emit, supaya pesan berikutnya tidak membentur `TURN_IN_PROGRESS` saat kartu diproses. Pesan dengan L1 `crisis` tidak pernah ditolak karena lock.
- Parameter sesi (02 §6.3) dibaca dari konfigurasi, bukan konstanta di kode.

### Safety
- L1 deterministik berjalan **sebelum** agent dan tidak bergantung jaringan. Frasa L1 adalah konten berversi dari psikolog, bukan hardcode.
- Kuota habis tidak melewati safety: pesan tetap melalui L1 dan L2 (`/v1/safety/classify`; tidak tersedia → `elevated`). `quota.exhausted` selalu membawa kontak bantuan.
- Token persona ditahan sampai event `safety` dari agent; giliran `crisis` tidak pernah meneruskan token persona.
- Risiko lengket: `crisis` tidak turun; `elevated` kembali `normal` setelah 3 giliran normal. Sesi `crisis` tidak dihitung kuota dan tidak ditutup oleh batas waktu aktif/wall-clock (idle tetap berlaku).
- Gagal tertutup bila agent/Vertex tidak tersedia (02 §7.2).
- Setiap `crisis` → `ai_safety_events` + alert internal **tanpa isi pesan**.

### Data dan privasi
- Isi pesan dan ringkasan disimpan terenkripsi (`*_ciphertext`, KMS). Tidak ada isi percakapan di log, trace, metrik, error, atau alert.
- Simpan pesan idempoten pada `(session_id, client_message_id)`.
- Migrasi additive (expand → migrate → contract). Tidak ada FK lintas database.
- Konten klinis hanya aktif bila `approved` (`ai_content_versions` append-only).

### Output terstruktur
Gateway yang memvalidasi kartu dari agent (02 §7.4): routine, asesmen, handoff. Output yang tidak lolos dibuang diam-diam dan dicatat sebagai metrik.

### Test wajib (02 §12.1)
Kuota dua perangkat bersamaan, waktu aktif, pengecualian krisis, validasi output, token/JWKS (aud salah, exp, kid tak dikenal), webhook idempoten.
