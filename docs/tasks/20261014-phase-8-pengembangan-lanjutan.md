# Phase 8 — Pengembangan Lanjutan

**Tanggal:** 2026-10-14
**Phase:** Phase 8 — Pengembangan Lanjutan ([03-phase.md](../03-phase.md))
**Komponen:** gateway, agent, content, e2e, docs, `deeptalk-web-v2`, `deeptalk-app-v2`, `psikolog-deeptalk-dashboard`
**Recap terkait:** [20261014-phase-7-peluncuran-bertahap.md](20261014-phase-7-peluncuran-bertahap.md), [20261010-phase-4-5-consent-data-portal-psikolog.md](20261010-phase-4-5-consent-data-portal-psikolog.md)

## Tujuan

Menyiapkan pengembangan setelah rilis pertama di level kode, dengan gerbang yang sama seperti sebelumnya (konten disetujui psikolog dan evaluasi lulus): skala persona ke seluruh psikolog, topik routine tambahan, daily check-in dan skrining berkala dengan grafik tren, inventori kepribadian saat onboarding, pemantau ambang RAG, dan persiapan ekspansi Asia Tenggara.

Phase 7 belum GA (⛔). Pekerjaan ini membangun kode dan konten `DRAFT`; tidak ada yang aktif di `prod` sebelum konten `approved` dan blocker phase sebelumnya lepas.

## Daftar Pekerjaan

### Persona untuk seluruh psikolog
- [x] Router Quick Chat tetap kecil saat persona banyak: kandidat per topik dibatasi, dipilih bergiliran (persona yang paling jarang dipakai 7 hari terakhir didahulukan) supaya beban merata antarpsikolog — `routerCandidates` (maks. 12) + `PersonaUsageService`; unit test
- [x] Daftar persona di web/app bisa difilter per topik dengan label topik yang mudah dibaca — mulai 5 persona; label "Fokus: …"; belum diuji ke v3 berjalan
- [ ] Persona sungguhan untuk seluruh psikolog — terblokir: psikolog menyusun lewat workflow Phase 5 ([konten-klinis-gelombang-pertama](../blockers/konten-klinis-gelombang-pertama.md))

### Topik routine tambahan
- [x] Kind konten `topic` (label, deskripsi, boleh routine atau tidak); seed DRAFT untuk topik yang ada
- [x] Placeholder DRAFT pustaka routine untuk `tidur` dan `kecemasan`
- [x] `GET /v1/review/coverage`: per topik, berapa persona/knowledge/routine/pemetaan asesmen yang `approved` (dasar menambah topik) — juga progres persona psikolog; unit + E2E
- [x] Halaman "Cakupan" di dashboard (`/teman-ai/cakupan`)
- [ ] Topik dan isi routine final — terblokir: [keputusan-phase-8-lanjutan](../blockers/keputusan-phase-8-lanjutan.md)

### Daily check-in, skrining berkala, inventori kepribadian
- [x] Kind konten `instrument` (tujuan `checkin` / `screening` / `personality`; butir, skor, rentang hasil, butir keamanan, interval); seed DRAFT (`checkin-harian`, `skrining-draft`, `inventori-kepribadian`)
- [x] Tabel `ai_instrument_responses` (aditif, migrasi `20261014023944_phase8_instruments_topics`, diterapkan di DB lokal saja): jawaban dan skor terenkripsi, metadata tanpa isi
- [x] API: daftar instrumen + status jatuh tempo, kirim jawaban (validasi versi, skor, rentang), riwayat/tren, hapus per entri/semua
- [x] Butir keamanan → protokol krisis di respons + kejadian keamanan `layer = instrument` (tanpa sesi/jawaban) + alert + metrik `crisis_detected`/`crisis_protocol_sent`
- [x] Gerbang yang sama dengan chat: rollout (token), usia, consent layanan
- [x] Ikut hapus akun, merge akun (bentrok tanggal → jawaban akun tujuan), dan retensi (`RETENTION_INSTRUMENT_RESPONSES_DAYS`); sengaja **tidak** ikut "hapus riwayat" (punya tombol sendiri)
- [x] Indikator dampak: `self_checks` (hitungan, tanpa skor) + tile di dashboard Dampak
- [x] Web: `/teman-ai/cek-diri` (hub + grafik tren SVG), `/teman-ai/cek-diri/[ref]` (form, hasil, riwayat), tawaran inventori opsional setelah onboarding, "Hapus data cek diri" — belum diuji ke v3 berjalan
- [x] App: sama dengan web (`teman-ai/cek-diri`, `react-native-svg`) — belum diuji di perangkat
- [ ] Instrumen final, butir keamanan, dan teks hasil — terblokir: [keputusan-phase-8-lanjutan](../blockers/keputusan-phase-8-lanjutan.md), [teks-hukum-consent-privasi-dpia](../blockers/teks-hukum-consent-privasi-dpia.md)

### RAG
- [x] Pemantau ambang materi (02 §7.3: ±50 ribu token atau >10 topik) di `rollout:readiness` dan skrip tersendiri (`pnpm run knowledge:budget`)
- [ ] Pindah ke RAG Engine/pgvector — belum perlu: ambang belum tercapai (0 token materi `approved`)

### Imbalan consent pelatihan
- [ ] Imbalan bagi pengguna yang menyetujui consent pelatihan — tidak dibangun: Konsep §7.1 "saat ini tidak ada imbalan"; keputusan di [keputusan-phase-8-lanjutan](../blockers/keputusan-phase-8-lanjutan.md)

### Ekspansi Asia Tenggara
- [x] Audit asumsi khusus Indonesia (bahasa, hotline, regulasi, zona waktu, residensi data, usia) dan langkah per negara — [ekspansi-asia-tenggara](../rilis/ekspansi-asia-tenggara.md)
- [ ] Persiapan per negara — terblokir: negara belum diputuskan

### Verifikasi
- [x] Unit test gateway (237), E2E skenario Phase 8 (28/28), regresi E2E (174 PASS, 5 skenario)
- [x] Typecheck/lint/test/build web, app (`expo export` iOS), dashboard
- [ ] Agent tidak diubah; test agent tidak dijalankan ulang
- [ ] `terraform fmt/validate` untuk metrik baru — terblokir: [tooling-lokal-terraform-docker](../blockers/tooling-lokal-terraform-docker.md)

### Dokumentasi
- [x] 02, 03, AGENT.md, skill gateway, content README, e2e README, `docs/slo.md`, blocker, recap web (`docs/phase/README.md`) dan app (`docs/tasks/20261014-teman-ai-phase-8-cek-diri.md`)

## File yang Diubah

**deeptalk-ai/gateway**
- `prisma/schema.prisma`, `prisma/migrations/20261014023944_phase8_instruments_topics/` — `ai_instrument_responses`, enum `AiInstrumentPurpose`, `AiContentKind` + `topic`/`instrument`, `AiSafetyLayer` + `instrument`
- `src/content/content.schemas.ts` — `topicSchema`, `instrumentSchema`; `review.service.ts` — kind baru bisa dikurasi
- `src/content/coverage.ts` (+ spec), `coverage.controller.ts` (`TopicsController`, `CoverageController`), `content.module.ts`
- `src/instruments/` (baru): `scoring.ts` (+ spec), `instruments.service.ts` (+ spec), `instruments.controller.ts`, `instruments.module.ts`; `src/app.module.ts`
- `src/realtime/persona-pool.ts` (+ spec), `conversation.service.ts` (+ spec), `realtime.module.ts`
- `src/safety/safety.service.ts`, `alert.service.ts` — layer `instrument`, teks alert "tanpa sesi"
- `src/lifecycle/lifecycle.service.ts`, `retention.service.ts`; `src/config/env.schema.ts`, `.env.example`
- `src/impact/impact.service.ts` (+ spec) — `self_checks`
- `src/routines/routine-rules.ts`, `routines.service.ts` — `isTimeZone` dibagi
- `scripts/knowledge-budget.ts` (baru), `scripts/rollout-readiness.ts`, `package.json` (`knowledge:budget`), `src/content/knowledge-budget.spec.ts`

**deeptalk-ai lain**
- `content/topics/*.json`, `content/instruments/*.json`, `content/routine-library/{tidur,kecemasan}.json` (DRAFT), `content/README.md`
- `e2e/phase8.mjs` (baru), `e2e/fake-v3.js`, `e2e/stack.sh`, `e2e/run.sh`, `e2e/README.md`
- `infra/modules/monitoring/metrics.tf`, `dashboard.tf` — `instrument_response`
- `docs/rilis/ekspansi-asia-tenggara.md` (baru), `docs/blockers/keputusan-phase-8-lanjutan.md` (baru), `docs/blockers/README.md` + riwayat 6 blocker, `docs/02-implementasi.md`, `docs/03-phase.md`, `docs/slo.md`, `AGENT.md`, `.claude/skills/gateway/SKILL.md`

**deeptalk-web-v2** (`feat/ai-phase-1`)
- `src/lib/api/errors.ts` (`ApiError.code`), `src/lib/api/ai.ts`, `src/lib/domain/ai.ts`
- `src/components/teman-ai/`: `trend-chart.tsx`, `self-check-screen.tsx`, `instrument-screen.tsx`, `personality-offer.tsx` (baru); `persona-picker.tsx`, `teman-ai-chat.tsx`, `data-settings-screen.tsx`
- `src/app/teman-ai/cek-diri/page.tsx`, `src/app/teman-ai/cek-diri/[ref]/page.tsx` (baru)
- `docs/phase/README.md`

**deeptalk-app-v2** (`feat/ai-phase-1`)
- `src/lib/ai.ts`; `src/components/teman-ai/`: `trend-chart.tsx`, `self-check.tsx`, `personality-offer.tsx` (baru), `persona-picker.tsx`
- `src/app/teman-ai/cek-diri/index.tsx`, `src/app/teman-ai/cek-diri/[ref].tsx` (baru); `src/app/teman-ai/index.tsx`, `data.tsx`
- `docs/tasks/20261014-teman-ai-phase-8-cek-diri.md`

**psikolog-deeptalk-dashboard** (`feat/ai-phase-5`)
- `features/teman-ai/types.ts`, `api.ts`, `hooks.ts`; `app/(app)/teman-ai/cakupan/page.tsx` (baru), `dampak/page.tsx`, `keamanan/page.tsx` (label layer); `components/teman-ai/shared.tsx` (label kind); `components/layout/app-sidebar.tsx`

## Keputusan

- **Satu mesin instrumen** untuk check-in, skrining, dan inventori kepribadian. Butir, skala, skor, rentang, dan butir keamanan semuanya konten klinis berversi (kind `instrument`). Gateway yang menghitung skor; client hanya mengirim jawaban.
- **Tanpa teks bebas.** Instrumen hanya pilihan, sehingga tidak ada isi yang perlu safety L1 dan tidak ada teks yang bisa bocor ke log.
- **Butir keamanan mengalahkan skor.** Jawaban di atas ambang selalu menampilkan protokol `crisis`/`elevated` dan mencatat kejadian `layer = instrument` (tanpa sesi, tanpa jawaban). Alert dan metrik SLO sama dengan percakapan.
- **Jawaban dan hasil terenkripsi** dalam satu ciphertext per baris (AAD = ID baris). Yang terlihat di DB hanya tujuan, tanggal, versi, dan level keamanan. Indikator dampak hanya menghitung baris, tidak pernah skor.
- **Satu entri per instrumen per hari lokal.** Mengisi lagi di hari yang sama berarti koreksi. Instrumen dengan interval (skrining 14 hari, inventori 180 hari pada draf) menolak entri baru sebelum waktunya (409 `INSTRUMENT_NOT_DUE`). Zona waktu dikirim client, dengan fallback `DEFAULT_TIMEZONE`.
- **Data cek diri hanya untuk pengguna:**
  - tidak dikirim ke agent;
  - tidak masuk ringkasan handoff;
  - tidak dipakai untuk mencocokkan persona.
  - Memakainya butuh keputusan klinis dan consent (profiling); dicatat di blocker.
- **Tidak ikut "hapus riwayat",** seperti routine. Pengguna punya tombol hapus sendiri (per entri dan semua). Hapus akun menghapusnya; merge memindahkannya.
- **Baris yang gagal didekripsi dilewati** di riwayat dan hanya nama errornya yang dicatat, supaya satu baris rusak tidak menyembunyikan seluruh tren.
- **Router untuk banyak persona:** maksimal 12 kandidat, yang paling jarang dipakai 7 hari terakhir didahulukan (juga untuk fallback), dan bergilir per topik supaya setiap topik terwakili. Agent tidak berubah.
- **Topik = konten.** Topik siap ditawarkan bila label, pengetahuan, dan minimal satu persona sudah `approved`; routine dan pemetaan asesmen ditampilkan sebagai kekurangan. Topik yang dikecualikan Konsep §3.6 tidak pernah mendapat routine.
- **RAG belum dibangun,** karena ambang belum tercapai. Pemantau ambang menjadi pemeriksaan `rollout:readiness`.
- **Imbalan consent pelatihan tidak dibangun** (Konsep §7.1).
- **Ekspansi: audit, bukan kode.** Kode multi-negara tidak dibangun sebelum negara, regulasi, dan mitra krisis diputuskan. Urutan langkahnya ada di dokumen ekspansi.
- **Grafik:**
  - SVG tanpa library baru, satu sumbu, hari yang kosong memutus garis;
  - legenda bila ada lebih dari satu seri, dengan tabel sebagai alternatif;
  - palet tervalidasi dataviz (web `#6c2f93/#e85c05/#0284c7`, app `#0C50F7/#e85c05/#0d9488`).

## Validasi

- Gateway: `lint` 0 error, `typecheck` bersih, `test` 237 lulus (sebelumnya 206), `build` ok. Migrasi diterapkan di DB lokal saja.
- E2E:
  - `phase8` 28/28 lulus, dijalankan ulang setelah perubahan `DEFAULT_TIMEZONE`.
  - Regresi penuh (`caffeinate -i ./run.sh`): 174 PASS, 0 FAIL di phase2-3, limits, resilience, phase4-5, phase8.
  - Log gateway tidak memuat jawaban (`grep` nama butir/`answers` = 0).
  - V3 dibangun dari `feat/ai-phase-1` di direktori sementara, karena checkout v3 di `deploy/prod`.
- `content:seed` lokal: 11 versi baru (DRAFT). `knowledge:budget` lokal: PASS (0 token `approved`). `rollout:readiness`: gagal seperti seharusnya (konten DRAFT); cek RAG lulus.
- Web: `tsc` bersih, lint 2 warning lama, vitest 121 lulus, `next build` ok (`/teman-ai/cek-diri`, `/teman-ai/cek-diri/[ref]`).
- App: `tsc` hanya error lama `app.config.ts`, lint hanya 2 error lama (checkout), prettier bersih, `expo export --platform ios` ok.
- Dashboard: `tsc`, lint, `pnpm build` ok (`/teman-ai/cakupan`).
- Belum:
  - uji web/app ke v3 dan gateway yang berjalan;
  - tampilan grafik belum dilihat di browser atau perangkat (tidak bisa login ke v3 lokal);
  - test agent (agent tidak diubah);
  - `terraform fmt/validate`.

## Blocker

- [keputusan-phase-8-lanjutan](../blockers/keputusan-phase-8-lanjutan.md) (baru) — topik, instrumen dan butir keamanannya, tujuan inventori, pemakaian data cek diri, imbalan, negara ekspansi.
- [konten-klinis-gelombang-pertama](../blockers/konten-klinis-gelombang-pertama.md) — kind `topic`/`instrument`, persona untuk seluruh psikolog.
- [teks-hukum-consent-privasi-dpia](../blockers/teks-hukum-consent-privasi-dpia.md) — kategori data cek diri.
- [keputusan-q10-retensi](../blockers/keputusan-q10-retensi.md) — `RETENTION_INSTRUMENT_RESPONSES_DAYS`.
- [keputusan-q5-q12-oncall-krisis](../blockers/keputusan-q5-q12-oncall-krisis.md) — tindak lanjut kejadian `instrument`.
- [uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md), [tooling-lokal-terraform-docker](../blockers/tooling-lokal-terraform-docker.md).
- Phase 7 belum GA, sehingga urutan 03 §3 belum terpenuhi.

## Follow-up

- Pengingat push untuk check-in harian (seperti pengingat routine). Belum dibuat; perlu keputusan apakah check-in boleh mengirim notifikasi.
- Lihat grafik di browser dan perangkat dengan data nyata setelah client bisa login ke v3 dev.
- Bila inventori diputuskan untuk personalisasi, rancang consent profiling dan alirannya ke agent.
- Terapkan migrasi `phase8_instruments_topics` lewat pipeline. Urutannya harus sesudah migrasi Phase 7, karena ada `ALTER TYPE … ADD VALUE`.

## Rekap Status

**⛔ Terblokir.**
- **Selesai dan terverifikasi lokal:** 20 dari 28 item.
  - Router banyak persona, filter topik, kind `topic` + Cakupan.
  - Cek diri lengkap di gateway, web, app, dashboard.
  - Pemantau RAG, audit ekspansi, dokumentasi.
- **Belum (8):**
  - Konten final: persona, topik, instrumen.
  - Negara ekspansi.
  - Imbalan (tidak diputuskan).
  - RAG (belum perlu).
  - Test agent (tidak diubah).
  - Terraform fmt.
- Tidak ada yang aktif di `prod` sebelum konten disetujui psikolog, keputusan diambil, dan Phase 7 mencapai GA.
