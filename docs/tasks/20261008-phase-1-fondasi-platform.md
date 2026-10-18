# Phase 1 — Fondasi Platform

**Tanggal:** 2026-10-08
**Phase:** Phase 1 — Fondasi Platform ([03-phase.md](../03-phase.md))
**Komponen:** gateway, agent, cloudbuild, `deeptalk-api-v3`, `deeptalk-web-v2`, `deeptalk-app-v2`
**Recap terkait:** [20261008-skeleton-awal.md](20261008-skeleton-awal.md); v3: `deeptalk-api-v3/docs/tasks/20261008-ai-token-exchange.md`

## Tujuan

Pengguna dan psikolog bisa mendapat token AI dari v3, terhubung ke gateway multi-instance, dan menerima balasan streaming dari agent. Belum ada persona atau safety (03 Phase 1).

Phase 0 (proyek GCP, keputusan Q2/Q7) belum selesai, jadi semua bagian dibangun dengan jalur produksi (KMS, ID token, Vertex AI) **dan** fallback lokal yang ditolak di production. Pembuktian dilakukan secara lokal.

## Daftar Pekerjaan

### deeptalk-api-v3 (branch `feat/ai-phase-1`, dibuat dari `fix/transaction-detail-without-report` karena `master` tertinggal jauh)
- [x] Kunci ES256, `GET /v2/.well-known/ai-jwks.json` (tanpa envelope), prosedur rotasi `kid` (`docs/guidance/ai-token-exchange.md`)
- [x] `POST /v2/user/ai/access`, `POST /v2/psikolog/ai/access`, `GET /v2/user/ai/availability`
- [x] Kontrol rollout `AI_ROLLOUT_MODE` (default `off`), `AI_ALLOWED_USER_IDS`, `AI_ROLLOUT_PERCENT` (bucket stabil)
- [x] `AiServiceTokenGuard` + `GET /v2/internal/ai/users/:userId`
- [x] Env schema, `.env.example`, unit test, `openapi.yaml`, recap v3

### gateway
- [x] Migrasi awal Prisma (`20261008072312_init`), diterapkan ke database lokal `deeptalk_ai_dev`
- [x] Verifikasi token via JWKS (`jose`): REST guard, handshake socket, `auth.refresh`, putus saat `exp`
- [x] Namespace `/ai` + Redis adapter + room per pengguna; fan-out dua instance diuji
- [x] Sesi minimal: dibuat saat pesan pertama dengan kunci `ai_user_state`
- [x] `message.send` → simpan idempoten → agent → relay `ai.token`/`ai.done`/`ai.error`; lock Redis per sesi; retry memicu jawaban ulang bila balasan hilang
- [x] Enkripsi isi pesan: AES-256-GCM, AAD = ID baris, envelope encryption Cloud KMS; `MESSAGE_LOCAL_KEY` hanya non-production
- [x] Riwayat sesi untuk reconnect (`GET /v1/sessions/current`)
- [ ] Logging aman, metrik dasar, tracing — belum: tracing. Logging aman dan metrik (log terstruktur `metric`) selesai

### agent
- [x] `POST /v1/turn` SSE dengan ADK + aturan global `global-v0-draft` (DRAFT)
- [x] Model lokal deterministik (`MODEL_PROVIDER=local`) untuk dev/test tanpa Vertex AI
- [ ] Gateway memanggil agent dengan ID token (Cloud Run IAM) — terblokir: [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md) (kode klien ada, belum pernah berjalan)

### CI/CD dan client
- [ ] Pipeline Cloud Build — terblokir: [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md) (`cloudbuild/*.yaml` ditulis, belum dijalankan)
- [ ] Web: `use-ai-session.ts` + layar `/teman-ai` di balik `availability` — terblokir: [uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md) (dibangun; typecheck, lint, vitest, build lulus; belum diuji ke v3 yang berjalan)
- [ ] App: `use-ai-session.ts` + layar `teman-ai` di balik `availability` — terblokir: [uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md) (dibangun; tsc, lint, bundle iOS lulus; belum dijalankan di perangkat)

### Ditambahkan selama task
- [x] Skrip smoke `gateway/scripts/smoke-chat.mjs` (satu giliran lintas dua instance + riwayat REST)
- [x] Perbaikan bug yang ditemukan di latihan deploy: shutdown memanggil `server.disconnectSockets()` yang lewat Redis adapter memutus pengguna di **semua** instance → `server.local.disconnectSockets()` + test regresi
- [x] Perbaikan build: `nest build` kedua tidak menghasilkan `dist/` karena `tsbuildinfo` di luar `dist/` → `tsBuildInfoFile` dipindah ke `dist/`
- [x] Dokumentasi: `AGENT.md`, skill `gateway`/`agent`, `03-phase.md`, README root, `docs/phase/README.md` web, register blocker

### Exit criteria
- [ ] Satu percakapan dari web **dan** app ke Gemini, di `dev`, dua instance gateway — terblokir: [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md), [uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md). Lokal: lulus tanpa UI dengan model lokal
- [ ] Token ditolak bila `aud` salah, kedaluwarsa, `kid` tidak dikenal, atau di luar rollout — terblokir di `dev`. Lokal: lulus
- [ ] Deploy gateway saat sesi berjalan → reconnect tanpa kehilangan pesan — terblokir di `dev`. Lokal: lulus dengan SIGTERM
- [ ] Log, trace, dan error tanpa isi percakapan — belum: tracing belum ada. Log dan DB lokal: lulus

## File yang Diubah

**deeptalk-ai**
- `gateway/src/auth/*` — verifier JWKS, guard REST, decorator, `testing.ts` (penerbit token untuk spec, dikecualikan dari build).
- `gateway/src/realtime/ai.gateway.ts`, `turn.service.ts`, `realtime.module.ts`, `redis-io.adapter.ts` (`maxHttpBufferSize` 16 KB) — alur percakapan.
- `gateway/src/sessions/*` — `SessionsService`, `period.ts`, `SessionsController`.
- `gateway/src/messages/*` — `MessagesService`, `crypto/` (envelope, KMS/lokal), modul.
- `gateway/src/agent-client/*` — klien SSE + ID token.
- `gateway/src/redis/*`, `common/drain/*`, `observability/metrics.service.ts`, `observability.module.ts` — lock, drain saat shutdown, metrik.
- `gateway/src/database/prisma.service.ts` — menunggu drain sebelum disconnect.
- `gateway/src/config/env.schema.ts` (+spec), `config/testing.ts` — `AGENT_AUTH`, `AGENT_TIMEOUT_MS`, `TURN_HISTORY_MESSAGES`, `MESSAGE_LOCAL_KEY`, aturan production.
- `gateway/src/app.module.ts` — Drain, Observability, Redis.
- `gateway/prisma/migrations/*` — migrasi `init`.
- `gateway/package.json`, `tsconfig.jest.json`, `test/jest-e2e.json`, `tsconfig.build.json` — `google-auth-library`, `eventsource-parser`; transpile ESM di Jest; `tsBuildInfoFile`.
- `gateway/Dockerfile` — target `migrate`. `gateway/.env.example` — variabel baru.
- `gateway/scripts/smoke-chat.mjs` — baru.
- `agent/app/turn.py`, `app/routes/v1.py`, `app/main.py`, `app/config.py` — `/v1/turn`, `MODEL_PROVIDER`, `LOCAL_MODEL_TOKEN_DELAY_MS`.
- `agent/agents/persona.py`, `agents/local_llm.py`, `prompts/__init__.py`, `prompts/global/v0-draft.md` — agen persona, model lokal, aturan global DRAFT.
- `agent/tests/*`, `agent/pyproject.toml` (override mypy `google.adk.*`), `agent/.env.example`.
- `cloudbuild/*` — pipeline gateway, agent, promote.
- `AGENT.md`, `README.md`, `.claude/skills/gateway/SKILL.md`, `.claude/skills/agent/SKILL.md`, `docs/03-phase.md`, `docs/blockers/*`.

**deeptalk-api-v3** — lihat recap v3 (`src/modules/ai/*`, `src/config/env.schema.ts` (+spec), `src/app.module.ts`, `.env.example`, `openapi.yaml`, `docs/guidance/ai-token-exchange.md`).

**deeptalk-web-v2** (branch `feat/ai-phase-1`)
- `src/lib/domain/ai.ts` (+test), `src/lib/api/ai.ts`, `src/hooks/use-ai-session.ts`, `src/components/teman-ai/teman-ai-chat.tsx`, `src/app/teman-ai/{layout,page}.tsx` — fitur.
- `src/lib/api-status.ts` (+test) — `/teman-ai` ikut mode maintenance/pre-release.
- `docs/phase/README.md` — status lintas repo.

**deeptalk-app-v2** (branch `feat/ai-phase-1`)
- `src/lib/ai.ts`, `src/hooks/use-ai-session.ts`, `src/app/teman-ai.tsx`, `src/app/_layout.tsx` — fitur dan registrasi route.

## Keputusan

- Token v3 diverifikasi dengan `jose` (bukan klien JWKS buatan sendiri seperti di v3): ES256 saja, `iss`/`aud`, `requiredClaims`, toleransi jam 5 detik, cache JWKS 5 menit, cooldown 30 detik untuk `kid` baru.
- Psikolog tidak dibatasi persentase rollout (hanya `off`), karena gelombang pertama butuh akses lebih dulu. Token psikolog ditolak di namespace `/ai`.
- Satu giliran per sesi dengan lock Redis (TTL = `AGENT_TIMEOUT_MS` + 15 detik). Pesan kedua saat giliran berjalan ditolak `TURN_IN_PROGRESS` tanpa disimpan.
- Shutdown: socket lokal diputus agar client pindah instance, giliran yang berjalan diselesaikan (drain ≤ 8 detik) sebelum Prisma/Redis ditutup. Bila instance crash (tanpa drain), retry baru dijawab setelah TTL lock habis (≈ 75 detik di produksi).
- Envelope KMS: satu data key per instance, rotasi 24 jam, cache unwrap 1.000 kunci. AAD = ID baris pesan.
- Metrik dikirim sebagai log terstruktur (log-based metrics) untuk Phase 1; tracing ditunda.
- Client memakai WebSocket saja (gateway tidak menerima polling, karena multi-instance tanpa sticky session untuk polling).
- Aturan global agent ditulis sebagai `DRAFT` agar Phase 1 bisa diuji. Wajib ditinjau psikolog sebelum `prod` (03 §1).

## Validasi

- [x] v3: `jest src/modules/ai src/config` 29 lulus; seluruh suite 221/1476 lulus; eslint file yang diubah bersih; build lulus.
- [x] gateway: `lint:check`, `typecheck`, `build`, `prisma validate` bersih; unit 95 lulus (14 suite); e2e 2 lulus; build ulang dua kali tetap menghasilkan `dist/`.
- [x] agent: `ruff format --check`, `ruff check`, `mypy --strict` (23 file), `pytest` 17 lulus.
- [x] web: `tsc --noEmit`, `pnpm lint` (hanya 2 warning lama di file lain), `vitest` 116 lulus, `pnpm build` lulus (route `/teman-ai`).
- [x] app: `tsc --noEmit` tanpa error baru (6 error lama di `app.config.ts`), `expo lint` tanpa error baru (2 error lama di `checkout.tsx`), `expo export --platform ios` lulus.
- [x] Integrasi lokal: issuer token = `AiTokenService` v3 hasil build + JWKS-nya; dua instance gateway (Redis + Postgres lokal); agent model lokal. `smoke-chat.mjs` 9/9 lulus (ack, token, `ai.done` di socket instance lain, riwayat REST).
- [x] Penolakan token di gateway berjalan: `kid` tak dikenal, `aud` salah, kedaluwarsa → socket `UNAUTHORIZED` + REST 401; token psikolog → `FORBIDDEN` + 403; tanpa token → 401.
- [x] Latihan deploy (SIGTERM di tengah giliran): giliran diselesaikan instance yang shutdown, balasan sampai ke socket di instance lain dan ke client yang reconnect, retry idempoten, tepat satu balasan tersimpan.
- [x] Latihan crash (SIGKILL): retry langsung tidak menggandakan giliran; setelah TTL lock habis, retry memicu balasan.
- [x] Privasi: tidak ada isi percakapan di log gateway/agent; metrik hanya angka/enum; `ai_messages.content_ciphertext` versi 1 tanpa plaintext.
- [ ] Cloud KMS asli, ID token Cloud Run, Gemini via Vertex AI, pipeline Cloud Build, Terraform — terblokir ([lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md)).
- [ ] Layar web/app ke v3 yang berjalan — terblokir ([uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md)).
- [ ] `docker build` (termasuk target `migrate`) — terblokir ([tooling-lokal-terraform-docker](../blockers/tooling-lokal-terraform-docker.md)).

## Blocker

- [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md) — Phase 0 belum ada: tanpa GCP `dev`, exit criteria dan jalur KMS/ID token/Gemini/pipeline tidak bisa dibuktikan.
- [uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md) — butuh v3 `feat/ai-phase-1` berjalan dengan token exchange dikonfigurasi dan akun uji di allowlist.
- [tooling-lokal-terraform-docker](../blockers/tooling-lokal-terraform-docker.md) — diperbarui; masih terbuka.

## Follow-up

- [ ] Review dan commit di keempat repo (belum ada commit; v3/web/app di branch `feat/ai-phase-1`).
- [ ] Tracing OpenTelemetry → Cloud Trace (tanpa isi pesan).
- [ ] Tinjauan psikolog untuk aturan global (`agent/prompts/global/v0-draft.md`) sebelum versi non-DRAFT.
- [ ] Pintu masuk Teman AI di navigasi web/app (Phase 1 hanya route langsung `/teman-ai`).
- [ ] Phase 2: safety L1/L2/L3 + safety gate, kuota dan waktu aktif, persona.
- [ ] Database lokal `deeptalk_ai_dev` di Postgres Homebrew dibiarkan untuk pengembangan; hapus dengan `dropdb deeptalk_ai_dev` bila tidak dipakai.

## Rekap Status

**Status:** ⛔ Terblokir
**Progres:** 18/27 item selesai

| Belum selesai | Alasan |
|---|---|
| Logging aman, metrik dasar, tracing | Belum: tracing |
| Agent dipanggil dengan ID token | Terblokir: lingkungan-gcp-dev |
| Pipeline Cloud Build | Terblokir: lingkungan-gcp-dev |
| Web `/teman-ai` | Terblokir: uji-client-ke-v3-dev |
| App `teman-ai` | Terblokir: uji-client-ke-v3-dev |
| Exit criteria #1 (percakapan web+app ke Gemini di `dev`) | Terblokir: lingkungan-gcp-dev, uji-client-ke-v3-dev |
| Exit criteria #2 (penolakan token di `dev`) | Terblokir: lingkungan-gcp-dev (lokal lulus) |
| Exit criteria #3 (deploy saat sesi berjalan di `dev`) | Terblokir: lingkungan-gcp-dev (lokal lulus) |
| Exit criteria #4 (log/trace/error tanpa isi) | Belum: tracing (log dan DB lokal lulus) |
