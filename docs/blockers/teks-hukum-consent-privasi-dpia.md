# Teks Consent, Kebijakan Privasi, dan DPIA dari Konsultan Hukum

**Status:** `OPEN`
**Dibuka:** 2026-10-11 · **Diselesaikan:** —
**Jenis:** eksternal
**Pemilik penyelesaian:** konsultan hukum UU PDP (penunjukan: Phase 0), Pak Novri
**Memblokir:** Phase 4 — "Kebijakan privasi web/app diperbarui", "DPIA selesai", exit criteria "Teks consent dan kebijakan privasi disetujui konsultan hukum"
**Muncul di task:** [20261010-phase-4-5-consent-data-portal-psikolog.md](../tasks/20261010-phase-4-5-consent-data-portal-psikolog.md)

## Masalah

Mekanisme consent sudah dibangun (Phase 4), tetapi teks consent layanan dan consent pelatihan masih DRAFT buatan engineering (`content/consents/*.json`, ditandai `[DRAFT]`). Kebijakan privasi web dan app belum menyebut penyedia model, lokasi pemrosesan, masa simpan, dan hak pengguna untuk Teman AI. DPIA belum dimulai, dan konsultan hukum belum ditunjuk (Phase 0).

## Dampak

- Tanpa konfigurasi khusus, ketiadaan teks consent `approved` membuat gerbang mengembalikan `CONSENT_UNAVAILABLE` (gagal tertutup). Untuk masa beta saja, `AI_TRIAL_ALLOW_WITHOUT_SERVICE_CONSENT=true` mengizinkan pengguna yang lolos gerbang usia mengakses Teman AI tanpa persetujuan layanan, kecuali bila mereka secara eksplisit pernah menolak/mencabut persetujuan; flag ini harus dinonaktifkan saat rilis resmi. Kewajiban menyelesaikan teks final dan tinjauan hukum sebelum rilis resmi tetap berlaku.
- Kebijakan privasi dan DPIA adalah syarat rilis (02 §9.1).

## Yang sudah dicoba / diketahui

- Teks consent bisa dimasukkan sebagai versi baru lewat dashboard (Konten klinis → Teks persetujuan) dan disetujui reviewer kedua. Versi engineering tidak bisa disetujui.
- `min_accepted_version` sudah mendukung perubahan material (persetujuan ulang) tanpa deploy.
- Fakta teknis untuk DPIA dan kebijakan privasi sudah tercatat di 02 §9: enkripsi KMS, `asia-southeast2`, hapus/merge akun, hapus riwayat, consent pelatihan berlaku mundur saat dicabut, kejadian keamanan tanpa isi.

## Yang dibutuhkan untuk lepas

- [ ] Penunjukan konsultan hukum UU PDP (Phase 0).
- [ ] Teks consent `service` dan `ai_training` final, termasuk ringkasan poin (maks. 8). Wajib **menyebut penyedia AI (Google Cloud Gemini Enterprise Agent Platform / Vertex AI)**, lokasi penyimpanan per tahap (Singapura untuk beta; Indonesia untuk production/rilis resmi), pemrosesan AI di Amerika Serikat, dan apa yang dilakukan model dengan data — App Store 5.1.2(i), lihat [kebijakan toko](../rilis/kebijakan-toko-aplikasi.md).
- [ ] Pembaruan kebijakan privasi web dan app untuk Teman AI.
- [ ] DPIA selesai.
- [ ] Keputusan Q4 (usia) dan Q10 (retensi) yang dirujuk teks-teks di atas.

## Opsi dan usulan

| Opsi | Konsekuensi |
|---|---|
| Hukum menulis teks, reviewer klinis memasukkannya lewat dashboard | Riwayat versi dan penyetuju tercatat |
| Engineering memasukkan teks lewat `content:seed` | Tetap masuk sebagai draft; harus disetujui di dashboard |

**Usulan default:** opsi pertama.

## Riwayat

- 2026-10-11 — dibuka dari task Phase 4–5.
- 2026-10-11 — task Phase 6: kebutuhan App Store 5.1.2(i) dan Play (Data safety, Health apps declaration) ditambahkan.
- 2026-10-14 — task Phase 7: teks consent layanan `approved` dicek oleh `rollout:readiness`; materi komunikasi per tahap juga perlu tinjauan hukum.
- 2026-10-14 — task Phase 8: kategori data baru — jawaban check-in, skrining, dan inventori kepribadian (data kesehatan, terenkripsi, hanya untuk pengguna). Teks consent layanan, kebijakan privasi, dan DPIA perlu mencakupnya; memakai inventori untuk personalisasi = profiling dan butuh teks tersendiri.
- 2026-10-14 — task Phase 9: dua teks baru (DRAFT): `legacy_counseling` (pengguna, riwayat konseling chat lama) dan `psikolog_addendum` (kontrak psikolog). DPIA pemanfaatan data punya bagian engineering di [dpia-phase-9-engineering](../data/dpia-phase-9-engineering.md); gerbang `dpia` di `pnpm run data:gate` baru boleh dibuka dengan nomor dokumen final.
- 2026-10-15 — Q7: model Gemini diproses di **Amerika Serikat** (region `us`), data disimpan di Jakarta. Teks consent layanan, kebijakan privasi web/app, dan DPIA harus menyebut transfer data pribadi ke luar negeri dan dasar hukumnya (UU PDP Pasal 56). Teks DRAFT sudah disesuaikan (versi 2); klaim "diproses di Indonesia" tidak boleh dipakai.
- 2026-10-17 — Klarifikasi tahapan penyimpanan: data versi beta disimpan di Singapura; data production atau rilis resmi disimpan di Indonesia (`asia-southeast2`). Pemrosesan AI tetap berlangsung di Amerika Serikat melalui Google Cloud Gemini Enterprise Agent Platform (Vertex AI), region `us`. Draft consent layanan diperbarui ke versi 5; perlu ditinjau konsultan hukum sebelum digunakan.

## Penyelesaian

—
