# Phase 2 & 3 — Percakapan Inti, Keamanan, dan Output

**Tanggal:** 2026-10-10
**Phase:** Phase 2 — Percakapan Inti & Keamanan; Phase 3 — Output: Routine, Asesmen, Handoff ([03-phase.md](../03-phase.md))
**Komponen:** gateway, agent, content, cloudbuild, `deeptalk-api-v3`, `deeptalk-web-v2`, `deeptalk-app-v2`
**Recap terkait:** [20261008-phase-1-fondasi-platform.md](20261008-phase-1-fondasi-platform.md)

## Tujuan

Membangun Phase 2 (persona, safety berlapis, kuota dan waktu aktif, memori) dan Phase 3 (Daily Routine, rekomendasi asesmen, handoff ke psikolog). Konten klinis dari psikolog belum ada, jadi engineering memakai seed `DRAFT` (03 §1) yang tidak pernah aktif di production.

## Daftar Pekerjaan

### Fondasi data dan konten
- [x] Skema Phase 2–3 (konten berversi, persona, safety events, ringkasan, routine, asesmen, handoff) + migrasi `20261010104413_phase2_3_content_safety_routines_handoffs` (additive), diterapkan ke `deeptalk_ai_dev` lokal
- [x] Modul konten: versi aktif `approved`; `draft` hanya di non-production bila `CONTENT_ALLOW_DRAFT=true` (ditolak di production)
- [x] Seed `content/` bertanda DRAFT + `pnpm run content:seed` (append-only)

### Phase 2 — Keamanan
- [x] L1 deterministik di gateway (frasa sebagai konten berversi, normalisasi slang/angka/huruf berulang/klitik) — frasa masih DRAFT
- [x] L2 klasifikasi + safety gate di agent; timeout/error → `elevated` — diuji dengan model lokal; Gemini Flash asli belum (terblokir: [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md))
- [x] L3 pengecekan output (streaming) + template pengganti; `ai.done.replaced`
- [x] Risiko lengket per sesi; `ai_safety_events` (hanya ID frasa/sinyal); alert `CRITICAL` tanpa isi + webhook opsional
- [x] Protokol krisis berversi; `safety.escalation`; pesan `role: protocol`; safety floor engineering bila konten tidak ada — isi protokol DRAFT
- [x] Gagal tertutup saat agent/Vertex tidak tersedia (`AGENT_UNAVAILABLE` + info bantuan; krisis tetap lewat L1)
- [x] Endpoint bantuan publik `GET /v1/help` untuk web tanpa login dan cache offline app

### Phase 2 — Persona dan percakapan
- [x] Persona Card dimuat ke prompt (urutan 02 §7.3, instruksi callable); `GET /v1/personas`
- [ ] Pengetahuan klinis per topik (+ context caching) — pemuatan per topik selesai; context caching terkonfigurasi tetapi belum terverifikasi di Vertex (terblokir: [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md)); materi asli terblokir: [konten-klinis-gelombang-pertama](../blockers/konten-klinis-gelombang-pertama.md)
- [x] Router Quick Chat dengan alasan
- [x] `session.start`, `persona.switch`, `persona.unavailable`
- [x] Memori lintas sesi (ringkasan terenkripsi via outbox) + `GET/PATCH /v1/me/settings`, `DELETE /v1/me/memory`

### Phase 2 — Sesi dan kuota
- [x] Kuota bulanan dengan kunci baris; sesi krisis tidak dihitung
- [x] Waktu aktif, `session.warning`, `wrap_up`, `session.closing` + tenggang, idle, wall-clock (BullMQ, jobId memuat waktu jatuh tempo)
- [x] Kuota habis: L1 + L2 dulu (`/v1/safety/classify`), baru `quota.exhausted` dengan kontak bantuan
- [x] Rate limit per pengguna (20/menit; pesan krisis dikecualikan)

### Phase 3 — Output
- [x] Routine: usulan dari pustaka aktif, validasi gateway (≤ 3 item, risiko `normal`, topik dikecualikan, ≤ 2 routine aktif, sekali per sesi), `card.routine`, `routine.decision`
- [x] Routine: REST checklist harian, log (catatan terenkripsi), riwayat, rangkuman mingguan
- [ ] Routine: pengingat (scheduler → gateway → v3 notifications) — jalur gateway → v3 selesai dan diuji lokal; job Cloud Scheduler belum pernah berjalan (terblokir: [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md))
- [x] Asesmen: katalog v3 ∩ pemetaan, `card.assessment`, hasil asesmen pengguna (tanpa skor) sebagai konteks
- [x] Handoff: direktori v3 ∩ psikolog handoff, draft ringkasan (tier Pro, terenkripsi), hapus bagian, `handoff.decision`
- [x] Handoff: tautan ke booking (diverifikasi ke v3), konfirmasi ulang psikolog lain, notifikasi psikolog via v3, baca ringkasan hanya oleh psikolog yang ditugaskan (selain itu 404)

### deeptalk-api-v3
- [x] `GET /v2/internal/ai/users/:userId/assessments`
- [x] `GET /v2/internal/ai/bookings/:bookingId`
- [x] `POST /v2/internal/ai/notifications` (idempoten per `notification_key`)
- [x] `GET /v2/psikolog/book/:bookingId/ai-summary`

### Client web dan app
- [ ] Pilih persona / Quick Chat, label "DeepTalk AI dengan pendekatan …", sisa kuota, peringatan dan akhir sesi — dibangun di web dan app; terblokir: [uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md)
- [ ] UI krisis (`safety.escalation`) dan layar bantuan (web publik, app offline) — dibangun; web `/teman-ai/bantuan` dicek dengan `next dev`; sisanya terblokir: [uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md)
- [ ] Kartu routine, asesmen, handoff — dibangun; terblokir: [uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md)
- [ ] Layar Rutinitas (checklist, riwayat, pesan hari terlewat) — dibangun; terblokir: [uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md)
- [ ] Tautan handoff setelah booking — dibangun (web dan app); terblokir: [uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md)

### Evaluasi dan verifikasi
- [ ] Studi kasus safety DRAFT + evaluator L1+L2 + gerbang di pipeline — evaluator dan gerbang lokal lulus; `cloudbuild/promote.yaml` belum pernah berjalan (terblokir: [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md)); set final terblokir: [konten-klinis-gelombang-pertama](../blockers/konten-klinis-gelombang-pertama.md)
- [x] Test checklist Phase 2 (krisis tidak bocor, kuota bersamaan, krisis saat kuota habis, agent mati, L3, restart timer) — lokal, `e2e/`
- [x] Uji integrasi lokal Phase 2–3 (`e2e/run.sh`: `phase2-3`, `limits`, `resilience`)
- [x] Perbaikan race lock giliran yang ditemukan E2E (lihat Keputusan)

### Dokumentasi
- [x] `docs/02-implementasi.md`, `docs/03-phase.md`, `AGENT.md`, `README.md`, skill gateway/agent, `e2e/README.md`, register blocker

### Exit criteria Phase 2
- [ ] Gerbang evaluasi safety lulus di pipeline — terblokir: [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md), terblokir: [konten-klinis-gelombang-pertama](../blockers/konten-klinis-gelombang-pertama.md)
- [ ] Persona gelombang pertama dinilai berbeda gayanya oleh psikolog pemiliknya — terblokir: [konten-klinis-gelombang-pertama](../blockers/konten-klinis-gelombang-pertama.md)
- [x] Tidak ada jalur di mana pengguna berisiko menerima pesan "kuota habis" (unit + E2E `limits`)

### Exit criteria Phase 3
- [ ] Alur Rani berjalan dari awal sampai akhir di `staging`, di web dan app — lokal tanpa UI lulus; terblokir: [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md), terblokir: [uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md), terblokir: [konten-klinis-gelombang-pertama](../blockers/konten-klinis-gelombang-pertama.md)
- [x] Output terstruktur dengan ID palsu tidak pernah lolos validasi (unit gateway)
- [x] Psikolog yang tidak ditugaskan di booking tidak bisa membaca ringkasannya (unit gateway + v3, E2E `phase2-3`)

## File yang Diubah

**deeptalk-ai/gateway**
- `prisma/schema.prisma`, `prisma/migrations/20261010104413_phase2_3_content_safety_routines_handoffs/` — enum dan tabel Phase 2–3, kolom baru `ai_sessions`, role `protocol`.
- `src/content/*` — skema zod konten, `ContentService` (cache 60 detik), `personaView`, `GET /v1/personas`, `GET /v1/help`.
- `src/safety/*` — L1 (`l1.ts` + spec), risiko lengket, `SafetyService`, `AlertService`, safety floor.
- `src/sessions/*` — `openForMessage`, kuota, waktu aktif, timer BullMQ, memori, `history.ts`, REST sesi/pengaturan/memori.
- `src/outbox/*`, `src/queue/queues.ts`, `src/common/emitter/*` — outbox + BullMQ, emit ke room pengguna.
- `src/v3-client/*` — klien v3 (psikolog, asesmen, booking, notifikasi).
- `src/routines/*`, `src/assessments/*`, `src/handoffs/*`, `src/auth/internal-token.guard.ts` — output Phase 3 dan endpoint internal.
- `src/realtime/*` — `TurnService` (precheck, kuota, lock), `ConversationService`, `SessionStateService`, handler socket baru.
- `src/agent-client/*` — event `safety`/`structured`/`done`, endpoint router/classify/summary/handoff.
- `src/messages/*`, `src/redis/redis.service.ts`, `src/config/env.schema.ts` (+spec), `.env.example` — pesan protokol, helper Redis, env baru.
- `scripts/seed-content.ts`, `scripts/eval-l1.ts`, `scripts/register-nodenext-resolution.js`, `tsconfig.build.json`, `package.json` (`ioredis`, skrip baru).
- Spec: conversation, turn, gateway, routines, handoffs, assessments, l1, agent-client, env.

**deeptalk-ai/agent**
- `app/contract.py`, `app/config.py`, `app/turn.py`, `app/routes/v1.py`, `app/main.py` — kontrak, `TurnRunner` dengan safety gate, endpoint baru.
- `agents/{llm,local_llm,run,safety,persona,router,summary,handoff,cards}.py` — tier model, model lokal, L2/L3, prompt berlapis, router, ringkasan, handoff, kartu.
- `prompts/*` — prompt DRAFT berversi per jenis.
- `evals/safety.py`, `pyproject.toml`, `tests/*`.

**deeptalk-ai lainnya**
- `content/*` — seed DRAFT: frasa L1, protokol, 2 persona, pengetahuan 4 topik, pustaka routine 2 topik, pemetaan/daftar handoff kosong, 14 studi kasus sintetis; `content/README.md`.
- `cloudbuild/promote.yaml`, `cloudbuild/README.md` — gerbang `eval-l1` → `eval-gate` → promote.
- `e2e/*` (baru), `.gitignore` — harness E2E lokal.
- `docs/02-implementasi.md`, `docs/03-phase.md`, `docs/blockers/*`, `AGENT.md`, `README.md`, `.claude/skills/{gateway,agent}/SKILL.md`.

**deeptalk-api-v3** (branch `feat/ai-phase-1`) — recap v3 `docs/tasks/20261010-ai-phase-3-internal-endpoints.md`: `src/modules/ai/*` (internal assessments/booking/notifications, klien gateway, ringkasan psikolog), `src/redis/redis.service.ts`, `src/config/env.schema.ts`, `.env.example`, `openapi.yaml`.

**deeptalk-web-v2** (branch `feat/ai-phase-1`)
- `src/lib/domain/ai.ts` (+test), `src/lib/api/ai.ts`, `src/hooks/use-ai-session.ts` — tipe, API gateway, hook semua event.
- `src/components/teman-ai/*` — chat, panel krisis, pemilih persona, kartu routine/asesmen/handoff, penyimpanan/tautan/konfirmasi handoff, pengaturan memori, layar Rutinitas.
- `src/app/teman-ai/{rutinitas,bantuan}/page.tsx` — halaman baru; `src/lib/api-status.ts` (+test) — `/teman-ai/bantuan` selalu tersedia.
- `src/app/psychologists/[id]/page.tsx`, `src/app/counseling/booking/{participants,checkout}/page.tsx` — tangkap `ai_handoff`, tautkan ke booking, konfirmasi ulang.
- `.env.example`, `README.md`, `docs/phase/README.md`.

**deeptalk-app-v2** (branch `feat/ai-phase-1`)
- `src/lib/{ai,ai-help,ai-handoff}.ts`, `src/hooks/use-ai-session.ts`, `src/components/teman-ai/*` — API, cache bantuan offline, handoff, hook, komponen.
- `src/app/teman-ai/{index,rutinitas,bantuan}.tsx` (menggantikan `teman-ai.tsx`), `src/app/_layout.tsx` — layar dan tap push `teman_ai_routine`.
- `src/app/counseling/{participant,checkout}.tsx`, `src/app/counseling/psychologist/[id].tsx`, `app.config.ts` (`extra.aiGatewayUrl`).

## Keputusan

- Konten DRAFT hanya dimuat bila `CONTENT_ALLOW_DRAFT=true`, dan env ini ditolak di production. Tanpa konten `approved`, production memakai safety floor engineering (frasa L1 minimal + protokol yang merujuk ke 112), bukan konten kosong.
- Jalur kuota habis menjalankan L1 lalu L2 (`/v1/safety/classify`); bila L2 tidak tersedia, pesan diperlakukan `elevated` dan pengguna menerima info bantuan. `quota.exhausted` selalu membawa kontak bantuan.
- Sesi `crisis` tidak dihitung kuota dan tidak ditutup oleh batas waktu aktif/wall-clock; idle tetap berlaku.
- Token persona ditahan di agent sampai vonis L2 (event `safety` selalu pertama) dan sekali lagi di gateway. Giliran `crisis` membatalkan persona sehingga tidak ada token yang keluar.
- `elevated` kembali ke `normal` setelah 3 giliran normal berturut-turut; `crisis` tidak pernah turun dalam sesi.
- Lock giliran dilepas setelah balasan/protokol tersimpan dan **sebelum** `ai.done`/`safety.escalation` dipancarkan. Pesan dengan L1 `crisis` tidak pernah ditolak `TURN_IN_PROGRESS` (jalur krisis tidak memanggil agent). Ditemukan oleh E2E: pesan krisis yang dikirim tepat setelah `ai.done` bisa ditolak karena kartu masih diproses.
- jobId timer BullMQ memuat waktu jatuh tempo: BullMQ membuang job baru dengan jobId sama selama job lama aktif, sehingga timer yang dijadwalkan ulang bisa hilang.
- Kartu dari agent dikirim dengan `exclude_none=True` dan gateway menerima field opsional `null` (`.nullish()`), karena kartu valid sempat ditolak `invalid_shape`.
- Instruksi persona dikirim ke ADK sebagai callable agar kurung kurawal di konten tidak diperlakukan sebagai template state.
- Q9: diterapkan default "berdiri sendiri" (data di Cloud SQL AI, layar `/teman-ai/rutinitas`) sampai keputusan diambil.
- Ringkasan handoff dibaca psikolog lewat v3 (`GET /v2/psikolog/book/:bookingId/ai-summary` → gateway internal); psikolog yang tidak ditugaskan menerima 404, bukan 403, agar keberadaan ringkasan tidak bocor.

## Validasi

- [x] gateway: `lint:check`, `typecheck`, `build` bersih; unit 166 lulus; e2e 2 lulus; `prisma validate` bersih; migrasi diterapkan ke `deeptalk_ai_dev` lokal.
- [x] agent: `ruff format --check`, `ruff check`, `mypy --strict` bersih; `pytest` 33 lulus.
- [x] v3: `jest src/modules/ai` 36 lulus; seluruh suite 224/1489 lulus; eslint file yang diubah bersih; build lulus.
- [x] web: `tsc --noEmit` bersih; `pnpm lint` hanya 2 warning lama; `vitest` 119 lulus; `pnpm build` lulus; `/teman-ai/bantuan` dirender tanpa login dengan `next dev`.
- [x] app: `tsc --noEmit` tanpa error baru (6 error lama di `app.config.ts`); `expo lint` tanpa error baru (2 error lama di `checkout.tsx`); `expo export --platform ios` lulus.
- [x] E2E lokal (`e2e/run.sh`, v3 tiruan dengan `AiTokenService` asli, agent lokal, dua gateway): `phase2-3` (39 cek), `limits`, `resilience` lulus; `phase2-3` diulang 3× setelah perbaikan lock, semua lulus.
- [x] Gerbang evaluasi lokal: `eval:l1` + `evals.safety` lulus pada 14 studi kasus sintetis (8/8 `crisis`); jalur gagal terbukti (kasus `crisis` tambahan yang tidak tertangkap → exit 1).
- [x] Privasi: tidak ada isi percakapan di log gateway/agent/v3 tiruan selama E2E; DB hanya menyimpan ciphertext untuk pesan, ringkasan, catatan routine, dan draft/final handoff; `ai_safety_events` hanya ID frasa/sinyal; alert `CRITICAL` tanpa isi.
- [ ] Gemini (L2, persona, tier Pro), context caching, Cloud KMS, ID token, Cloud Build `promote.yaml`, Cloud Scheduler — terblokir: [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md).
- [ ] Layar web/app Phase 2–3 ke v3 yang berjalan, push FCM nyata — terblokir: [uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md).
- [ ] Gerbang evaluasi dengan set studi kasus final dan konten `approved` — terblokir: [konten-klinis-gelombang-pertama](../blockers/konten-klinis-gelombang-pertama.md).
- [ ] `docker build` — terblokir: [tooling-lokal-terraform-docker](../blockers/tooling-lokal-terraform-docker.md).

## Blocker

- [konten-klinis-gelombang-pertama](../blockers/konten-klinis-gelombang-pertama.md) — **baru**: persona (Q1), protokol dan hotline (Q5, Q6), frasa L1, set evaluasi, pengetahuan, pustaka routine, pemetaan asesmen, daftar handoff masih DRAFT/kosong.
- [keputusan-q9-routine-selftalk](../blockers/keputusan-q9-routine-selftalk.md) — **baru**: hubungan Daily Routine dengan SelfTalk; default "berdiri sendiri" diterapkan.
- [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md) — diperbarui: cakupan Phase 2–3 (L2, context caching, gerbang di pipeline, tier Pro, Cloud Scheduler).
- [uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md) — diperbarui: UI Phase 2–3 di web dan app.
- [tooling-lokal-terraform-docker](../blockers/tooling-lokal-terraform-docker.md) — masih terbuka.

## Follow-up

- [ ] Review dan commit di keempat repo (belum ada commit; v3/web/app di branch `feat/ai-phase-1`).
- [ ] Tracing OpenTelemetry → Cloud Trace (sisa Phase 1).
- [ ] Job Cloud Scheduler `routine-reminders` dan secret `SCHEDULER_TOKEN` di `infra/`.
- [ ] Jalankan `e2e/` (atau uji integrasi berbasis DB) di CI dengan Postgres + Redis.
- [ ] v3: `tsBuildInfoFile` di `dist/` agar build berulang tidak menghasilkan `dist/` kosong (dicatat di recap v3).
- [ ] UI ringkasan handoff di `psikolog-deeptalk-dashboard` dan `psikolog-app-v2` (Phase 5).
- [ ] Phase 4: consent, gerbang usia, webhook hapus/merge akun (pengaturan memori dan `DELETE /v1/me/memory` sudah ada).
- [ ] Database lokal `deeptalk_ai_dev` dan Redis db 15 dipakai E2E; hapus bila tidak dipakai.

## Rekap Status

**Status:** ⛔ Terblokir
**Progres:** 34/45 item selesai

| Belum selesai | Alasan |
|---|---|
| Pengetahuan klinis + context caching | Terblokir: lingkungan-gcp-dev (caching), konten-klinis-gelombang-pertama (materi) |
| Pengingat routine via Cloud Scheduler | Terblokir: lingkungan-gcp-dev (jalur gateway → v3 lulus lokal) |
| Client: persona/kuota/sesi | Terblokir: uji-client-ke-v3-dev |
| Client: UI krisis + layar bantuan | Terblokir: uji-client-ke-v3-dev |
| Client: kartu routine/asesmen/handoff | Terblokir: uji-client-ke-v3-dev |
| Client: layar Rutinitas | Terblokir: uji-client-ke-v3-dev |
| Client: tautan handoff setelah booking | Terblokir: uji-client-ke-v3-dev |
| Gerbang evaluasi di pipeline | Terblokir: lingkungan-gcp-dev, konten-klinis-gelombang-pertama |
| Exit Phase 2: gerbang evaluasi di pipeline | Terblokir: lingkungan-gcp-dev, konten-klinis-gelombang-pertama |
| Exit Phase 2: persona berbeda gaya | Terblokir: konten-klinis-gelombang-pertama |
| Exit Phase 3: alur Rani di `staging` | Terblokir: lingkungan-gcp-dev, uji-client-ke-v3-dev, konten-klinis-gelombang-pertama |
