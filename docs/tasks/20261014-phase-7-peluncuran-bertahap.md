# Phase 7 — Peluncuran Bertahap → GA

**Tanggal:** 2026-10-14
**Phase:** Phase 7 — Peluncuran Bertahap → GA ([03-phase.md](../03-phase.md))
**Komponen:** gateway, e2e, docs, `deeptalk-web-v2`, `deeptalk-app-v2`, `psikolog-deeptalk-dashboard`
**Recap terkait:** [20261011-phase-6-hardening-produksi.md](20261011-phase-6-hardening-produksi.md)

## Tujuan

Menyiapkan semua yang dibutuhkan untuk membuka Teman AI bertahap (internal → beta → persentase → GA) berdasarkan data: pintu masuk di beranda, indikator dampak (Konsep §8) di dashboard, materi komunikasi yang klaimnya bisa dibuktikan, playbook tiap tahap dengan pemeriksaan kesiapan, dan tinjauan pasca-peluncuran.

Peluncuran sesungguhnya (mengubah `AI_ROLLOUT_MODE` di `prod`) butuh lingkungan GCP, konten klinis `approved`, teks hukum, dan on-call — semuanya masih blocker dari phase sebelumnya.

## Daftar Pekerjaan

### Klaim dan komunikasi
- [x] Perbaiki klaim yang tidak bisa dibuktikan di web ("dilatih dengan ribuan data percakapan", "dilatih khusus") — Phase 0 / 01 §4.2 — copy diganti; **belum disetujui** (blocker Q3)
- [x] Daftar klaim yang boleh/tidak boleh beserta buktinya, dan draf materi per tahap — draf; persetujuan menunggu blocker Q3 dan hukum

### Pintu masuk
- [x] Pintu masuk Teman AI di beranda web (hanya bila `availability.available`)
- [x] Pintu masuk Teman AI di beranda app (hanya bila `availability.available`) — web dan app belum diuji ke v3 berjalan (blocker `uji-client-ke-v3-dev`)

### Indikator dampak (Konsep §8)
- [x] Rujukan asesmen tercatat (kartu ditawarkan → dibuka) tanpa mengubah privasi; ikut hapus/merge akun dan hapus riwayat
- [x] `GET /v1/review/impact`: routine dibuat/diterima dan kepatuhannya, rujukan ke asesmen dan psikolog, penilaian keamanan (evaluasi persona, tinjauan kejadian, laporan respons)
- [x] Halaman "Dampak" di dashboard

### Kesiapan dan tinjauan
- [x] `pnpm run rollout:readiness`: syarat naik tahap yang bisa dihitung dari data
- [x] Playbook peluncuran per tahap (7.1–7.4) dan template tinjauan pasca-peluncuran

### Verifikasi
- [x] Unit test, E2E (rujukan asesmen, indikator dampak), regresi

### Dokumentasi
- [x] 02, 03, AGENT.md, skill, blocker, recap repo lain

### Tahap peluncuran
- [ ] 7.1 Internal — ⛔ konten klinis, teks hukum, on-call, GCP `prod`
- [ ] 7.2 Beta tertutup — ⛔ setelah 7.1 + keputusan Q3
- [ ] 7.3 Bertahap — ⛔
- [ ] 7.4 GA — ⛔

### Exit criteria
- [ ] `AI_ROLLOUT_MODE = all`
- [ ] Dua siklus kuota bulanan penuh berjalan di GA tanpa insiden safety terbuka

## File yang Diubah

**deeptalk-ai/gateway**
- `prisma/schema.prisma`, `prisma/migrations/20261013215209_phase7_assessment_referrals/` — tabel `ai_assessment_referrals` (aditif)
- `src/assessments/referrals.service.ts`, `referrals.controller.ts`, `assessments.module.ts` — catat kartu ditawarkan/dibuka
- `src/realtime/conversation.service.ts` (+ spec) — `card.assessment.referral_id`
- `src/lifecycle/lifecycle.service.ts` — rujukan ikut hapus akun, merge akun, hapus riwayat
- `src/impact/impact.service.ts`, `impact.controller.ts`, `impact.module.ts`, `impact.service.spec.ts`, `rollout-readiness.spec.ts`; `src/app.module.ts`
- `scripts/rollout-readiness.ts`, `package.json` (`rollout:readiness`)
- `../.claude/skills/gateway/SKILL.md` (root deeptalk-ai) — baris peta modul

**deeptalk-ai/e2e**
- `phase2-3.mjs` — rujukan asesmen (dibuka, kepemilikan) dan indikator dampak (agregat, tanpa identitas, peran reviewer)
- `stack.sh` — bersihkan `ai_assessment_referrals` uji
- `README.md` — syarat build v3 dengan modul AI

**deeptalk-ai/docs**
- `rilis/peluncuran-bertahap.md`, `rilis/tinjauan-pasca-tahap-template.md`, `rilis/materi-komunikasi.md` (baru)
- `blockers/keputusan-q3-peluncuran.md` (baru), `blockers/README.md`; riwayat di `uji-client-ke-v3-dev`, `lingkungan-gcp-dev`, `konten-klinis-gelombang-pertama`, `keputusan-q5-q12-oncall-krisis`, `teks-hukum-consent-privasi-dpia`
- `02-implementasi.md`, `03-phase.md`, `../AGENT.md`

**deeptalk-web-v2**
- `src/components/home/approach-section.tsx`, `home-hero.tsx`, `hero-section.tsx`, `src/app/about/page.tsx` — klaim
- `src/components/home/teman-ai-card.tsx` (baru), `src/app/page.tsx`
- `src/lib/domain/ai.ts`, `src/lib/api/ai.ts`, `src/components/teman-ai/assessment-card.tsx`, `teman-ai-chat.tsx`
- `docs/copywrite.md`, `docs/phase/README.md`

**deeptalk-app-v2**
- `src/components/home-teman-ai-card.tsx` (baru), `src/app/(tabs)/home.tsx`
- `src/lib/ai.ts`, `src/components/teman-ai/cards.tsx`, `src/app/teman-ai/index.tsx`

**psikolog-deeptalk-dashboard**
- `features/teman-ai/types.ts`, `api.ts`, `hooks.ts`; `app/(app)/teman-ai/dampak/page.tsx` (baru); entri sidebar "Dampak"

## Keputusan

- **Indikator dampak hanya agregat.** `GET /v1/review/impact` mengembalikan hitungan dan rasio, tanpa ID pengguna/sesi dan tanpa isi percakapan; rasio selalu tampil bersama angka dasarnya di dashboard. Akses: psikolog dengan peran `clinical_reviewer`.
- **"Asesmen dibuka" dicatat oleh client**, bukan dari v3: kartu membawa `referral_id`, client memanggil `POST …/opened` saat tautan diklik. Hanya pemilik rujukan yang bisa menandainya, dan hanya sekali. Pembelian/penyelesaian asesmen tidak dilacak (perlu data v3; bukan sekarang).
- **Kepatuhan routine** = log `done` dibagi item-hari yang direncanakan pada 7 hari terakhir, dari routine aktif.
- **Syarat naik tahap dipisah:** yang bisa dihitung dari data dicek `rollout:readiness` (exit 1 bila gagal); sisanya muncul sebagai pengingat MANUAL per tahap dan dicatat di tinjauan pasca-tahap.
- **Klaim situs** hanya yang bisa dibuktikan: AI, bukan psikolog; pendekatan disusun psikolog DeepTalk; tanda bahaya dialihkan; percakapan terenkripsi dan bisa dihapus. "Dilatih dengan ribuan data", "dilatih khusus", dan "100% privat" dihapus.
- **Pintu masuk** hanya tampil untuk pengguna login yang `availability.available`, jadi copy situs bisa terbit sebelum tahap mencapai pengguna tersebut.

## Validasi

- Gateway: `pnpm run lint` 0 error, `pnpm run build` ok, jest 206 lulus.
- E2E (`caffeinate -i ./run.sh`, 4 skenario): **146 PASS, 0 FAIL**, termasuk "assessment card carries a referral", "impact indicators aggregate…", "impact report carries no user identity", "impact needs the reviewer role". Run pertama gagal semua (`UNAUTHORIZED`) karena checkout v3 lokal sudah di `deploy/prod` tanpa modul AI sehingga fake v3 tidak start; dijalankan ulang dengan build `feat/ai-phase-1` di direktori terpisah (checkout v3 tidak diubah). Uji beban tidak diulang (tidak ada perubahan di jalur percakapan selain satu insert).
- `pnpm run rollout:readiness --stage internal` ke DB lokal: **GAGAL seperti seharusnya** (konten DRAFT, kejadian krisis uji belum ditinjau).
- deeptalk-web-v2: tsc bersih, lint 2 warning lama, vitest 121 lulus, `next build` ok.
- deeptalk-app-v2: tsc dan lint hanya error lama; `expo export` tidak dijalankan.
- psikolog-deeptalk-dashboard: tsc, lint, `pnpm build` ok.
- Belum diuji ke v3 berjalan maupun di perangkat.

## Blocker

- [keputusan-q3-peluncuran](../blockers/keputusan-q3-peluncuran.md) — baru: tahap/persentase, persetujuan copy dan materi, beta, tinjauan sampel.
- [konten-klinis-gelombang-pertama](../blockers/konten-klinis-gelombang-pertama.md) — syarat 7.1.
- [teks-hukum-consent-privasi-dpia](../blockers/teks-hukum-consent-privasi-dpia.md) — syarat 7.1.
- [keputusan-q5-q12-oncall-krisis](../blockers/keputusan-q5-q12-oncall-krisis.md) — syarat 7.1.
- [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md) — `prod` dan monitoring.
- [uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md) — pintu masuk dan "dibuka" belum diuji ke v3.

## Follow-up

- Setelah blocker lepas: jalankan `rollout:readiness --stage internal`, buka 7.1, isi [tinjauan pasca-tahap](../rilis/tinjauan-pasca-tahap-template.md) di akhir tiap tahap.
- Terapkan migrasi `phase7_assessment_referrals` ke `dev`/`staging`/`prod` lewat pipeline.
- Pertimbangkan indikator "asesmen dibeli/selesai" bila v3 kelak menyediakan agregat (butuh keputusan; jangan migrasi v3).
- Exit criteria (dua siklus kuota di GA tanpa insiden) baru bisa diukur setelah GA.

## Rekap Status

**⛔ Terblokir.** Semua yang bisa dibangun tanpa lingkungan `prod` sudah selesai dan teruji lokal: klaim situs, pintu masuk web/app, indikator dampak (gateway + dashboard), pemeriksaan kesiapan, playbook, template tinjauan, dan materi komunikasi. Tahap 7.1–7.4 dan exit criteria belum bisa dijalankan: menunggu konten klinis `approved`, teks hukum, on-call krisis, lingkungan GCP, dan keputusan Q3.
