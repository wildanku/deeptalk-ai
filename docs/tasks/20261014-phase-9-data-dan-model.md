# Phase 9 — Data & Model

**Tanggal:** 2026-10-14
**Phase:** Phase 9 — Data & Model ([03-phase.md](../03-phase.md))
**Komponen:** gateway, e2e, docs, `deeptalk-web-v2`, `deeptalk-app-v2`, `psikolog-deeptalk-dashboard`
**Recap terkait:** [20261014-phase-8-pengembangan-lanjutan.md](20261014-phase-8-pengembangan-lanjutan.md), [20261010-phase-4-5-consent-data-portal-psikolog.md](20261010-phase-4-5-consent-data-portal-psikolog.md)

## Tujuan

Menyiapkan perangkat untuk memanfaatkan data percakapan (Teman AI dan data konseling lama) **hanya setelah persetujuan yang sah** (Konsep §7.4):
- consent aktif dari pengguna lama;
- addendum psikolog dengan hak menolak;
- de-identifikasi otomatis (Sensitive Data Protection) dan tinjauan manual;
- DPIA dan tinjauan etik;
- pemanfaatan bertahap: evaluasi → contoh gaya persona → fine-tuning.

**Batas tegas:** tidak ada data asli yang disentuh di task ini. Tidak ada konektor ke store `chat-service`. Semua alat menolak berjalan sampai gerbang persetujuan tercatat, dan diuji hanya dengan data sintetis.

## Daftar Pekerjaan

### Consent
- [x] Consent pengguna `legacy_counseling` (opsional, tidak pernah default, diam ≠ setuju, bisa dicabut) — teks DRAFT; diuji E2E
- [x] Addendum psikolog berversi dengan pilihan per pemakaian (evaluasi / contoh gaya / pelatihan) — teks DRAFT; diuji E2E
- [x] Web/app: bagian consent data konseling lama di "Persetujuan & data" — belum diuji ke v3 berjalan
- [x] Dashboard: halaman "Penggunaan data" untuk psikolog

### Gerbang persetujuan
- [x] Register gerbang (`dpia`, `ethics_review`, `fine_tuning_go`) lewat `pnpm run data:gate` (wajib `--by` dan `--ref`, append-only); semua job menolak tanpa gerbang + `DATASET_ENABLED` — unit + E2E (termasuk cabut gerbang)

### Dataset
- [x] De-identifikasi: Sensitive Data Protection untuk production (`DATASET_DEID=dlp`, `parent` di `asia-southeast2`), penyamar lokal hanya untuk non-production (ditolak di production) — SDP diuji dengan klien tiruan saja
- [x] Pengumpulan kandidat dari sesi Teman AI: consent pelatihan aktif, `exclude_from_training = false`, bukan krisis — E2E
- [x] Impor data lama dari berkas hasil ekstraksi (bukan konektor): hanya pengguna dengan consent `legacy_counseling` dan psikolog yang mengizinkan — E2E dengan berkas sintetis
- [x] Tinjauan manual (peran baru `data_reviewer`) sebelum item bisa dipakai; reviewer hanya melihat teks yang sudah disamarkan — E2E
- [x] Ekspor bertahap per tujuan (evaluasi / contoh gaya / fine-tuning) dengan syarat masing-masing dan jejak audit — unit + E2E
- [x] Pencabutan consent, hapus akun, merge akun berlaku ke item dataset — pencabutan dan hapus akun diuji E2E; merge dan hapus riwayat lewat kode (belum ada pemeriksaan E2E khusus)
- [x] Dashboard: halaman tinjauan "Data pelatihan"

### Dokumen
- [x] Draf DPIA bagian engineering (alur data, risiko, mitigasi) dan pertanyaan untuk tinjauan etik — [dpia-phase-9-engineering](../data/dpia-phase-9-engineering.md)
- [x] Playbook pemanfaatan data (urutan gerbang dan siapa yang mencatat) — [pemanfaatan-data](../data/pemanfaatan-data.md)

### Di luar engineering
- [ ] Permintaan consent aktif ke pengguna lama dijalankan — terblokir: [pemanfaatan-data-phase-9](../blockers/pemanfaatan-data-phase-9.md)
- [ ] Addendum kontrak psikolog ditandatangani — terblokir: [pemanfaatan-data-phase-9](../blockers/pemanfaatan-data-phase-9.md)
- [ ] Ekstraksi data lama dari store `chat-service` — terblokir; tidak boleh sebelum gerbang dibuka
- [ ] DPIA dan tinjauan etik eksternal selesai — terblokir: [pemanfaatan-data-phase-9](../blockers/pemanfaatan-data-phase-9.md), [teks-hukum-consent-privasi-dpia](../blockers/teks-hukum-consent-privasi-dpia.md)
- [ ] Pemanfaatan: evaluasi → contoh gaya → fine-tuning — terblokir oleh semua di atas

### Verifikasi
- [x] Unit test (gateway 251), E2E skenario Phase 9 (29/29, data sintetis), regresi (203 PASS, 6 skenario)
- [x] Typecheck/lint/build web, app (`expo export` iOS), dashboard
- [ ] Sensitive Data Protection sungguhan (lokasi, jenis info) — terblokir: [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md)

### Dokumentasi
- [x] 02, 03 (+ ringkasan status semua phase dan item basi di Phase 0/1/3), AGENT.md, skill gateway, e2e README, docs README, blocker baru + riwayat, recap web (`docs/phase/README.md`) dan app (`docs/tasks/20261014-teman-ai-phase-9-legacy-consent.md`)

## File yang Diubah

**deeptalk-ai/gateway**
- `prisma/schema.prisma`, `prisma/migrations/*_phase9_data_consents_datasets/` — `ai_psikolog_data_consents`, `ai_data_gates`, `ai_dataset_items`, `ai_dataset_exports`; enum `AiConsentType` + `legacy_counseling`, `AiStaffRole` + `data_reviewer`, `AiDataGate`, `AiDatasetSource`, `AiDatasetItemStatus`, `AiDatasetPurpose`
- `src/datasets/` (baru): `gates.ts`, `deid.ts` (+ spec), `deid.provider.ts`, `withdraw.ts`, `datasets.service.ts` (+ spec), `psikolog-data-consent.service.ts`, `datasets.controller.ts`, `datasets.module.ts`, `datasets-cli.module.ts`; `src/app.module.ts`
- `src/consents/consent-policy.ts`, `consents.service.ts`, `onboarding.controller.ts` — `legacy_counseling`, penarikan item saat consent dicabut
- `src/content/content.schemas.ts` — `consent_text.type` + `legacy_counseling`, `psikolog_addendum`
- `src/lifecycle/lifecycle.service.ts` — item dataset di hapus akun, merge, hapus riwayat
- `src/config/env.schema.ts`, `.env.example` — `DATASET_ENABLED`, `DATASET_DEID`, `DLP_LOCATION`, `DATASET_MIN_FINE_TUNING_ITEMS`
- `scripts/dataset.ts`, `scripts/data-gate.ts` (baru), `scripts/grant-role.ts` (`data_reviewer`), `package.json` (`dataset`, `data:gate`, `@google-cloud/dlp`), `pnpm-lock.yaml`

**deeptalk-ai lain**
- `content/consents/legacy-counseling.json`, `content/consents/psikolog-addendum.json` (DRAFT)
- `e2e/phase9.mjs` (baru), `e2e/lib.mjs` (retry ECONNRESET keep-alive), `e2e/fake-v3.js`, `e2e/stack.sh`, `e2e/run.sh`, `e2e/README.md`
- `docs/data/pemanfaatan-data.md`, `docs/data/dpia-phase-9-engineering.md` (baru), `docs/blockers/pemanfaatan-data-phase-9.md` (baru), `docs/blockers/README.md` + riwayat 4 blocker, `docs/02-implementasi.md`, `docs/03-phase.md`, `docs/README.md`, `AGENT.md`, `.claude/skills/gateway/SKILL.md`

**deeptalk-web-v2** (`feat/ai-phase-1`): `src/lib/domain/ai.ts`, `src/components/teman-ai/data-settings-screen.tsx`, `docs/phase/README.md`

**deeptalk-app-v2** (`feat/ai-phase-1`): `src/lib/ai.ts`, `src/app/teman-ai/data.tsx`, `docs/tasks/20261014-teman-ai-phase-9-legacy-consent.md`

**psikolog-deeptalk-dashboard** (`feat/ai-phase-5`): `features/teman-ai/types.ts`, `api.ts`, `hooks.ts`; `app/(app)/teman-ai/penggunaan-data/page.tsx`, `app/(app)/teman-ai/data-pelatihan/page.tsx` (baru); `components/layout/app-sidebar.tsx`

## Keputusan

- **Terkunci secara default.** `DATASET_ENABLED=false` saja belum cukup untuk berjalan: setiap job juga butuh gerbang `dpia` dan `ethics_review` yang dicatat manusia dengan rujukan dokumen, dan `fine_tuning` butuh gerbang sendiri. Register gerbang bersifat append-only dan baris terbaru yang menentukan, sehingga pencabutan langsung berlaku.
- **Tidak ada konektor ke `chat-service`.** Data lama hanya masuk dari berkas ekstraksi yang dibuat di luar repo setelah gerbang dibuka. Penyaringan consent diulang saat impor.
- **Consent dicek dua kali,** saat pengumpulan/impor dan saat ekspor. Diam tidak pernah berarti setuju, untuk pengguna maupun psikolog.
- **Izin psikolog per pemakaian.**
  - Respons konseling lama adalah kata-kata psikolog, jadi semua pemakaian butuh izinnya.
  - Untuk percakapan Teman AI, evaluasi tidak butuh izin psikolog, tetapi contoh gaya dan pelatihan butuh izin psikolog pemilik persona.
- **De-identifikasi sebelum disimpan, per pesan.** Yang disimpan hanya teks yang sudah disamarkan (terenkripsi) dan hitungan temuan, tidak pernah nilainya. `local` ditolak di production bila pipeline aktif.
- **Peran `data_reviewer` terpisah dari `clinical_reviewer`.** Membaca teks percakapan, meskipun sudah disamarkan, adalah izin yang berbeda dari kurasi konten.
- **Pencabutan:**
  - item yang belum diekspor dihapus;
  - yang sudah diekspor ditarik (`withdrawn`, isinya dihapus), sehingga jejak pemakaian tetap ada;
  - hapus akun menghapus semua item; jejak ekspor tetap ada tanpa ID pengguna.
- **Sesi krisis tidak pernah dikumpulkan** (Konsep §7.2).
- **Skrip memakai konteks Nest minimal** (`DatasetsCliModule`): tanpa HTTP, socket, Redis, atau antrian.
- **Fine-tuning tidak dibangun.** Hanya gerbang, jumlah minimum, dan format ekspornya. Prosedur pelatihan ditulis saat `fine_tuning_go` dibuka.

## Validasi

- Gateway:
  - `lint` 0 error, `typecheck` bersih, `test` 251 lulus (sebelumnya 237), `build` ok.
  - Migrasi diterapkan di DB lokal saja.
  - `pnpm run dataset -- status` dan `data:gate -- status` dijalankan ke DB lokal. `dataset -- collect` ditolak (`DATASET_ENABLED, dpia, ethics_review`).
- E2E `phase9` 29/29 lulus:
  - gerbang tertutup menolak;
  - switch saja tidak cukup;
  - gerbang tanpa rujukan ditolak;
  - pengumpulan hanya dari sesi dengan consent dan bukan krisis, disamarkan dan terenkripsi, idempoten;
  - impor lama menyaring consent pengguna dan psikolog;
  - reviewer tanpa identitas;
  - ekspor per tujuan;
  - fine-tuning tanpa gerbang ditolak;
  - pencabutan → ditarik;
  - hapus akun;
  - cabut gerbang.
- Regresi penuh (`caffeinate -i ./run.sh`): 203 PASS, 0 FAIL di phase2-3, limits, resilience, phase4-5, phase8, phase9. Log gateway/agent tidak memuat nomor/email sintetis.
- Web: tsc bersih, lint 0 error (warning lama), vitest 121, `next build` ok.
- App: tsc/lint hanya error lama, prettier bersih, `expo export --platform ios` ok.
- Dashboard: tsc, lint, `pnpm build` ok (`/teman-ai/penggunaan-data`, `/teman-ai/data-pelatihan`).
- Belum:
  - Sensitive Data Protection sungguhan;
  - uji client ke v3 berjalan;
  - tampilan dashboard dengan login psikolog nyata.

## Blocker

- [pemanfaatan-data-phase-9](../blockers/pemanfaatan-data-phase-9.md) (baru) — consent pengguna lama, addendum, ekstraksi, DPIA, etik, peninjau data, bucket, keputusan fine-tuning.
- [teks-hukum-consent-privasi-dpia](../blockers/teks-hukum-consent-privasi-dpia.md) — dua teks baru + DPIA.
- [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md) — SDP, bucket.
- [keputusan-q10-retensi](../blockers/keputusan-q10-retensi.md) — retensi item dan berkas ekspor.
- [uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md).
- Urutan 03 §3: Phase 7 dan 8 belum selesai.

## Follow-up

- Uji SDP dengan sampel sintetis bahasa Indonesia dari psikolog, untuk menilai apakah nama dan tempat terdeteksi cukup baik. Hasilnya masuk DPIA.
- Pertimbangkan empat mata untuk persetujuan item dataset (pertanyaan untuk tinjauan etik).
- Pemeriksaan E2E khusus untuk merge akun dan hapus riwayat pada item dataset.
- Terapkan migrasi `phase9_data_consents_datasets` lewat pipeline, sesudah migrasi Phase 8.

## Rekap Status

**⛔ Terblokir.**
- **Selesai dan terverifikasi lokal:** 17 dari 23 item. Semua perangkat engineering sudah ada dan terkunci di balik gerbang.
- **Belum (6):** lima langkah di luar engineering (consent pengguna lama, addendum, ekstraksi, DPIA + etik, pemanfaatan) dan SDP sungguhan. Uji client ke v3 berjalan juga belum; dicatat di item web/app dan di blocker `uji-client-ke-v3-dev`.
- Tidak ada data asli yang disentuh, dan tidak ada yang boleh disentuh sebelum gerbang dibuka oleh pemiliknya.
