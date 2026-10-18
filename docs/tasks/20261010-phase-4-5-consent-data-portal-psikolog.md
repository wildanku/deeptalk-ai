# Phase 4 & 5 — Consent, Privasi & Siklus Data; Portal Psikolog & Kurasi Konten

**Tanggal:** 2026-10-10
**Phase:** Phase 4 — Consent, Privasi & Siklus Data; Phase 5 — Portal Psikolog & Kurasi Konten ([03-phase.md](../03-phase.md))
**Komponen:** gateway, agent, content, e2e, `deeptalk-api-v3`, `deeptalk-web-v2`, `deeptalk-app-v2`, `psikolog-deeptalk-dashboard`, `psikolog-app-v2`
**Recap terkait:** [20261010-phase-2-3-percakapan-keamanan-output.md](20261010-phase-2-3-percakapan-keamanan-output.md)

## Tujuan

Phase 4: consent berversi (layanan dan pelatihan), gerbang usia, hapus/merge akun dari v3, hapus riwayat, dan retensi. Phase 5: portal psikolog di dashboard (persona, evaluasi, handoff, kurasi konten klinis, tinjauan keamanan) dan notifikasi handoff di `psikolog-app-v2`.

Teks consent, kebijakan privasi, DPIA, Q4 (usia), dan Q10 (retensi) butuh hukum/keputusan. Engineering hanya menulis placeholder `DRAFT` dan nilai default yang bisa dikonfigurasi.

## Daftar Pekerjaan

### Phase 4 — gateway
- [x] Skema: migrasi `20261010154916_phase4_5_consent_lifecycle_portal` (additive) — `ai_consents`, `ai_sync_cursors`, `ai_staff_roles`, `ai_persona_workspaces`, `ai_eval_cases`, `ai_eval_runs`, `ai_eval_ratings`; kind konten baru; status `rejected`; kolom tinjauan; `ai_safety_events.session_id` nullable (`SET NULL`); `ai_user_state.age_checked_at`; CHECK `approved` ⇒ penyetuju. Diterapkan ke `deeptalk_ai_dev` lokal
- [x] Consent layanan wajib sebelum pesan pertama (`text_version`, `min_accepted_version`); `GET /v1/me/onboarding`, `GET/POST /v1/me/consents`; cabut consent layanan menutup sesi aktif
- [x] Consent pelatihan: ditawarkan di `session.ended` (sesi ≥ 3, tidak pernah `elevated`/`crisis`, belum dijawab); sesi baru tanpa consent aktif → `exclude_from_training`; mencabut berlaku mundur
- [x] Persetujuan ulang saat teks berubah material (`RECONSENT_REQUIRED`)
- [x] Gerbang usia dari `birth_date` v3 (`AGE_REQUIRED` / `AGE_RESTRICTED` dengan `AI_MIN_AGE=18` usulan Q4 / `AGE_UNVERIFIED`, fallback `age_band`); pesan krisis di semua gerbang tetap menerima protokol (dicatat tanpa sesi)
- [x] Siklus hidup akun: `POST /v1/internal/users/:id/delete`, `POST /v1/internal/users/merge` (idempoten) + penarik `account-events` v3 tiap `ACCOUNT_SYNC_INTERVAL_SECONDS` (BullMQ) + sapuan ulang 2 menit
- [x] `DELETE /v1/me/history`
- [x] Job retensi harian (BullMQ, 03.00); `RETENTION_*_DAYS` kosong = tidak menghapus (Q10); outbox operasional 30 hari

### Phase 4 — deeptalk-api-v3
- [x] `GET /v2/internal/ai/account-events` dari `deleted_data` (tanpa perubahan skema)
- [x] Push best-effort ke gateway setelah commit: tutup akun, hapus akun oleh admin, merge akun

### Phase 4 — client web dan app
- [ ] Layar consent layanan sebelum chat; persetujuan ulang — dibangun di web dan app; terblokir: [uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md)
- [ ] Tawaran consent pelatihan dengan tombol setara — dibangun; terblokir: [uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md)
- [ ] Gerbang usia: isi tanggal lahir (profil v3) / pesan tidak tersedia + bantuan — dibangun; terblokir: [uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md)
- [ ] Layar "Persetujuan & data" (`/teman-ai/data` web, `teman-ai/data` app) — dibangun; terblokir: [uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md)

### Phase 5 — gateway + agent
- [x] Peran `psikolog` (token) dan `clinical_reviewer` (`ai_staff_roles` + `pnpm run roles:grant`)
- [x] Persona saya: kuesioner → studi kasus → draft (`POST /v1/persona/draft`, tier Pro) → koreksi (versi baru) → evaluasi → persetujuan pemilik; nonaktifkan/aktifkan — model lokal; Gemini belum ([lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md))
- [x] Evaluasi: `POST /v1/eval/run` (L2 + L3); run BullMQ, penilaian aman/sesuai gaya/catatan; persetujuan butuh run lengkap yang semuanya aman
- [x] Handoff untuk psikolog: `GET /v1/psikolog/handoffs`, `GET /v1/psikolog/handoffs/:id` (`viewed`)
- [x] Kurasi konten klinis `/v1/review/content` (draft → in_review → approved/rejected; penyetuju ≠ penulis; seed engineering tidak bisa disetujui); pemetaan asesmen pindah ke konten `assessment_mapping`
- [x] Tinjauan keamanan `/v1/review/safety-events` tanpa isi dan tanpa identitas
- [x] Constraint DB: konten `approved` wajib punya `approved_by` dan `approved_at`

### Phase 5 — client psikolog
- [x] Dashboard: BFF `app/api/ai/[...path]` (token AI dari v3 di cookie httpOnly, hanya `psikolog/*` dan `review/*`, mint ulang saat ditolak) — diuji dengan v3 tiruan
- [ ] Dashboard: halaman Persona saya, Evaluasi, Ringkasan AI (+ kartu di detail booking), Konten klinis, Tinjauan keamanan, menu Teman AI — lint/tsc/build lulus, halaman ter-render; belum dipakai dengan login psikolog nyata (terblokir: [uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md))
- [ ] `psikolog-app-v2`: push `teman_ai_handoff` membuka ringkasan; kartu di detail booking — ter-bundle; belum diuji di perangkat (terblokir: [uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md))

### Evaluasi dan verifikasi
- [x] Unit test gateway, agent, v3
- [x] E2E lokal `phase4-5.mjs` (72 cek)
- [x] Regresi E2E Phase 2–3 (`phase2-3`, `limits`, `resilience`)

### Dokumentasi
- [x] 02, 03, AGENT.md, README konten/e2e, skill gateway/agent, blocker, recap v3 dan psikolog-app, status web, README dashboard

### Exit criteria Phase 4
- [ ] Hapus akun di v3 → tidak ada data pengguna tersisa (diuji end-to-end) — lulus lokal dengan v3 tiruan (webhook dan feed tarik); belum dengan v3 sungguhan (terblokir: [uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md))
- [x] Merge akun → riwayat, routine, dan kuota pindah dengan benar (E2E lokal)
- [ ] Teks consent dan kebijakan privasi disetujui konsultan hukum — terblokir: [teks-hukum-consent-privasi-dpia](../blockers/teks-hukum-consent-privasi-dpia.md)

### Exit criteria Phase 5
- [ ] Satu psikolog menyelesaikan kurasi personanya dari kuesioner sampai `approved` tanpa bantuan engineer — alur API lulus E2E; butuh psikolog sungguhan di dashboard (terblokir: [uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md)) dan kuesioner/studi kasus final ([konten-klinis-gelombang-pertama](../blockers/konten-klinis-gelombang-pertama.md))
- [x] Menonaktifkan persona menghentikannya di sesi berjalan dalam satu giliran (E2E lokal)
- [x] Setiap konten aktif di `prod` punya `approved_by` dan `approved_at` (CHECK di database, diuji)

## File yang Diubah

**deeptalk-ai/gateway**
- `prisma/schema.prisma`, `prisma/migrations/20261010154916_phase4_5_consent_lifecycle_portal/` — model Phase 4–5, CHECK penyetuju.
- `src/consents/*` (baru) — `ConsentsService`, `AgeService`, `OnboardingService`, `OnboardingController`, `consent-policy.ts`, `age.ts` (+spec).
- `src/lifecycle/*` (baru) — `LifecycleService`, `AccountSyncService` (+spec), `RetentionService`, processor, controller, modul dengan job scheduler.
- `src/evals/*` (baru) — `PersonaWorkspaceService`, `EvalRunsService` (+spec), processor, `PsikologController`.
- `src/content/content.schemas.ts`, `content.service.ts` (`invalidate`, `CONTENT_CACHE_SECONDS`), `review.service.ts` (+spec), `review.controller.ts`, `content.module.ts`.
- `src/safety/safety-review.controller.ts`, `safety.module.ts`, `safety.service.ts` / `alert.service.ts` (kejadian tanpa sesi).
- `src/auth/staff-roles.service.ts`, `staff-role.guard.ts` (+spec), `auth.module.ts`.
- `src/handoffs/psikolog-handoffs.controller.ts`, `handoffs.service.ts`, `handoffs.module.ts`.
- `src/realtime/turn.service.ts` (+spec) — gerbang sebelum sesi baru; `realtime.module.ts`.
- `src/sessions/sessions.service.ts` (consent pelatihan, tawaran, `close({ summarize })`), `memory.service.ts` (tulis ringkasan di bawah kunci sesi), `sessions.module.ts`.
- `src/assessments/assessments.service.ts` (+spec) — pemetaan dari konten berversi.
- `src/agent-client/agent-client.service.ts`, `src/v3-client/v3-client.service.ts`, `src/common/emitter/user-emitter.service.ts`, `src/queue/queues.ts`, `src/config/env.schema.ts`, `.env.example`.
- `scripts/grant-role.ts` (baru), `scripts/seed-content.ts`, `package.json` (`roles:grant`).

**deeptalk-ai/agent**
- `app/contract.py`, `app/routes/v1.py`, `app/main.py` — kontrak dan endpoint `persona/draft`, `eval/run`.
- `agents/persona_draft.py`, `agents/evaluation.py` (baru), `prompts/persona_draft/v0-draft.md`, `prompts/__init__.py`.
- `tests/test_endpoints.py`, `tests/test_app.py`.

**deeptalk-ai lainnya**
- `content/consents/*`, `content/persona-questionnaire/default.json`, `content/case-studies/default.json` (DRAFT, baru); `content/assessment-mappings/mappings.json` (kind `assessment_mapping`); `content/README.md`.
- `e2e/phase4-5.mjs` (baru), `fake-v3.js`, `lib.mjs` (`sql` tanpa shell), `stack.sh`, `run.sh`, `README.md`.
- `docs/02-implementasi.md`, `docs/03-phase.md`, `docs/blockers/*`, `AGENT.md`, `.claude/skills/{gateway,agent}/SKILL.md`.

**deeptalk-api-v3** (branch `feat/ai-phase-1`) — recap `docs/tasks/20261011-ai-account-events.md`.

**deeptalk-web-v2** (branch `feat/ai-phase-1`)
- `src/lib/domain/ai.ts` (+test), `src/lib/api/ai.ts`, `src/hooks/use-ai-session.ts`, `src/hooks/use-ai-access.ts` (baru, diekstrak dari layar Rutinitas).
- `src/components/teman-ai/{consent-text,onboarding-gate,training-consent-offer,data-settings-screen}.tsx` (baru), `teman-ai-chat.tsx`, `routines-screen.tsx`.
- `src/app/teman-ai/data/page.tsx` (baru), `docs/phase/README.md`.

**deeptalk-app-v2** (branch `feat/ai-phase-1`)
- `src/lib/ai.ts`, `src/hooks/use-ai-session.ts`, `src/components/teman-ai/onboarding.tsx` (baru), `src/app/teman-ai/{index,data}.tsx`, `src/app/_layout.tsx`.

**psikolog-deeptalk-dashboard** (branch baru `feat/ai-phase-5` dari `main`)
- `app/api/ai/[...path]/route.ts`, `lib/ai-token.ts` (baru), `app/api/auth/logout/route.ts`, `lib/api/client.ts`, `constant.ts`, `.env.example`, `README.md`.
- `features/teman-ai/*`, `components/teman-ai/*`, `app/(app)/teman-ai/**` (baru), `components/layout/app-sidebar.tsx`, `app/(app)/konseling/[id]/page.tsx`.

**psikolog-app-v2** (branch baru `feat/ai-phase-5` dari `dev`) — recap `docs/tasks/20261011-teman-ai-handoff-summary.md`.

## Keputusan

- **Outbox v3 tanpa perubahan skema:** `deleted_data` (ditulis dalam transaksi yang sama dengan penghapusan) dipakai sebagai outbox dan ditarik gateway; webhook setelah commit hanya jalur cepat dengan `event_id` yang sama. Membaca ulang 100 ID di belakang kursor menutup celah transaksi bersamaan.
- **Gerbang sebelum sesi baru, bukan per pesan.** Pesan yang ditolak tidak disimpan. Pesan L1 `crisis` dari pengguna yang belum lolos gerbang tetap menerima protokol; kejadiannya dicatat tanpa sesi dan tanpa identitas.
- **Usia:** v3 tetap satu-satunya sumber tanggal lahir (client menyimpannya lewat update profil v3); gateway hanya menyimpan `adult`/`minor` sebagai fallback saat v3 tidak terjangkau.
- **Consent pelatihan:** "Tidak sekarang" dicatat sebagai jawaban (tidak ditawarkan lagi untuk teks itu). Mencabut berlaku mundur ke semua sesi dan ringkasan. Sesi yang pernah `elevated` tidak memunculkan tawaran walau risikonya pulih.
- **Hapus riwayat:** baris sesi (kuota) dan routine tetap; ringkasan handoff yang sudah dibagikan untuk booking tetap (milik sesi konseling yang dijadwalkan). Sesi yang ditutup karena hapus riwayat tidak diringkas.
- **Kejadian keamanan saat akun dihapus** dipertahankan tanpa sesi (tidak bisa dikaitkan ke pengguna) sampai Q10 diputuskan.
- **Race ringkasan** (ditemukan E2E): job ringkasan yang membaca pesan tepat sebelum hapus riwayat menulis ringkasan setelahnya. Diperbaiki: penulisan ringkasan mengunci baris sesi dan memeriksa ulang pesan; hapus riwayat dan hapus akun mengunci sesi lebih dulu.
- **Persona:** disetujui psikolog pemiliknya (bukan reviewer), hanya setelah evaluasi lengkap minimal `PERSONA_MIN_EVAL_CASES` kasus yang semuanya dinilai aman. Contoh gaya di Persona Card adalah kata-kata psikolog sendiri, tidak ditulis ulang model. Persona nonaktif sampai versi pertama disetujui.
- **Konten klinis lain:** empat mata (penyetuju ≠ penulis); versi `seed:*` tidak pernah bisa disetujui — konten final harus masuk sebagai versi baru dari psikolog. Persetujuan berlaku di instance lain dalam `CONTENT_CACHE_SECONDS`.
- **Pemetaan asesmen** menjadi konten berversi `assessment_mapping`; tabel lama dibiarkan sampai langkah *contract* migrasi.
- **Dashboard:** token AI psikolog di cookie httpOnly terpisah (path `/api/ai`), BFF hanya meneruskan `psikolog/*` dan `review/*`; persetujuan dan teks evaluasi tidak pernah memuat percakapan pengguna (studi kasus sintetis).

## Validasi

- [x] gateway: `lint:check`, `typecheck`, `build`, `prisma validate` bersih; unit 189 lulus (24 suite); e2e 2 lulus; migrasi diterapkan ke `deeptalk_ai_dev` lokal.
- [x] agent: `ruff format --check`, `ruff check`, `mypy --strict` bersih; `pytest` 33 lulus (termasuk `persona/draft` dan `eval/run` dengan kasus normal, L3, crisis).
- [x] v3: suite AI/admin-user/profile 120 lulus; seluruh suite 225/1493 lulus; eslint bersih; build lulus; `openapi.yaml` ter-parse.
- [x] web: `tsc` bersih; `pnpm lint` hanya 2 warning lama; vitest 121 lulus; `pnpm build` lulus (`/teman-ai/data`).
- [x] app: `tsc` tanpa error baru (6 lama di `app.config.ts`); `expo lint` tanpa error baru (2 lama di checkout); `expo export --platform ios` lulus.
- [x] dashboard: `pnpm lint`, `tsc`, `pnpm build` lulus. BFF diuji dengan `next dev` + gateway + v3 tiruan: `/api/ai/psikolog/me` 200 dengan cookie AI httpOnly; rute pengguna dan traversal 404; tanpa sesi 401; sesi tidak valid 401; token AI basi → di-mint ulang (200); reviewer tanpa peran 403, dengan peran 200; halaman `/teman-ai` dan `/teman-ai/konten` 200.
- [x] psikolog-app-v2: `typecheck` bersih, `lint` tanpa error (3 warning lama), `expo export --platform ios` lulus.
- [x] E2E lokal: `phase4-5` lulus 3× (72 cek), regresi `phase2-3`, `limits`, `resilience` lulus. Log gateway/agent/v3 tiruan tidak memuat teks percakapan (0 kecocokan).
- [ ] Layar web/app/dashboard/psikolog-app ke v3 sungguhan dengan login nyata; push FCM ke perangkat — terblokir: [uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md).
- [ ] Draft persona dan evaluasi dengan Gemini — terblokir: [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md).

## Blocker

- [teks-hukum-consent-privasi-dpia](../blockers/teks-hukum-consent-privasi-dpia.md) — **baru**: teks consent final, kebijakan privasi, DPIA; tanpa teks `approved`, production menolak semua percakapan (`CONSENT_UNAVAILABLE`).
- [keputusan-q4-usia](../blockers/keputusan-q4-usia.md) — **baru**: batas usia final (18 diterapkan).
- [keputusan-q10-retensi](../blockers/keputusan-q10-retensi.md) — **baru**: masa retensi (job ada, periode kosong).
- [uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md) — diperbarui: UI Phase 4, dashboard, psikolog-app.
- [konten-klinis-gelombang-pertama](../blockers/konten-klinis-gelombang-pertama.md) — diperbarui: kuesioner persona dan studi kasus; penunjukan reviewer klinis.
- [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md) — diperbarui: draft persona dan evaluasi di Gemini.

## Follow-up

- [ ] Review dan commit di keenam repo (belum ada commit; dashboard dan psikolog-app di branch baru `feat/ai-phase-5`).
- [ ] Uji UI web/app/dashboard di browser atau perangkat terhadap stack lokal (belum dilakukan di task ini; hanya build dan BFF).
- [ ] Penunjukan reviewer klinis pertama (`roles:grant`) dan pengelolaan daftar psikolog handoff dari dashboard (masih lewat seed).
- [ ] Langkah *contract* migrasi: hapus tabel `ai_assessment_mappings` setelah semua lingkungan memakai konten `assessment_mapping`.
- [ ] Retensi ringkasan handoff (belum ada env) setelah Q10.
- [ ] Phase 6: SLO, runbook, uji beban, penetration test.

## Rekap Status

**Status:** ⛔ Terblokir
**Progres:** 25/34 item selesai

| Belum selesai | Alasan |
|---|---|
| Client: consent layanan + persetujuan ulang | Terblokir: uji-client-ke-v3-dev |
| Client: tawaran consent pelatihan | Terblokir: uji-client-ke-v3-dev |
| Client: gerbang usia | Terblokir: uji-client-ke-v3-dev |
| Client: "Persetujuan & data" | Terblokir: uji-client-ke-v3-dev |
| Dashboard: halaman Teman AI | Terblokir: uji-client-ke-v3-dev (build dan BFF lulus) |
| psikolog-app-v2: push dan ringkasan | Terblokir: uji-client-ke-v3-dev |
| Exit Phase 4: hapus akun end-to-end dengan v3 sungguhan | Terblokir: uji-client-ke-v3-dev (lokal lulus) |
| Exit Phase 4: teks consent dan kebijakan privasi disetujui hukum | Terblokir: teks-hukum-consent-privasi-dpia |
| Exit Phase 5: psikolog menyelesaikan kurasi tanpa engineer | Terblokir: uji-client-ke-v3-dev, konten-klinis-gelombang-pertama (API lulus E2E) |
