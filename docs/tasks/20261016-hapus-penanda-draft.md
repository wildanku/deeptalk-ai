# Hapus Penanda [DRAFT] dari Teks Konten (Psikolog & Pengguna)

**Tanggal:** 2026-10-16
**Komponen:** `content/`, DB lokal `deeptalk_ai_dev`, `docs/konten/`
**Terkait:** [blocker konten klinis](../blockers/konten-klinis-gelombang-pertama.md), [blocker teks hukum](../blockers/teks-hukum-consent-privasi-dpia.md)

## Tujuan

Wildan menyatakan teks DRAFT yang sudah ditulis (sisi psikolog dan pengguna) sudah oke dan meminta penanda `[DRAFT]` dihapus, setelah terlebih dahulu dibuat inventaris JSON terpisah untuk psikolog dan pengguna.

Keputusan Wildan: hanya **teks sungguhan** yang dibersihkan. **Placeholder** (penanda "belum ada isi") tetap bertanda supaya tidak tampil seolah isi final.

## Daftar Pekerjaan

- [x] Inventaris sebelum penghapusan: `docs/konten/draft-psikolog.json` (43 entri: 35 teks, 1 placeholder, 7 metadata) dan `docs/konten/draft-pengguna.json` (143 entri: 28 teks, 69 placeholder, 46 metadata). Sumber: `content/*.json` + DB (`ai_personas`, Persona Card approved). Tiap entri: sumber, path, teks sekarang, teks tanpa penanda, jenis, area, tampil langsung atau tidak
- [x] Hapus penanda dari 53 teks di 15 file `content/` (penggantian teks persis, format file dipertahankan); `version` file dinaikkan bila isi berubah (append-only)
- [x] `pnpm run content:seed` ke DB lokal: 20 versi baru (status tetap `draft`), 19 tidak berubah
- [x] Nama persona contoh di DB lokal: "Contoh Reflektif (DRAFT)" → "Contoh Reflektif", "Contoh Terstruktur (DRAFT)" → "Contoh Terstruktur"
- [x] Verifikasi lewat API akun uji: `/me/onboarding`, `/me/consents`, `/personas`, `/topics`, `/instruments` — tanda tersisa hanya pada placeholder; kuesioner dan studi kasus versi terbaru di DB tanpa tanda

## Yang sengaja tidak diubah

- **70 placeholder** (isi lengkap 4 teks persetujuan "akan disusun konsultan hukum", butir/opsi/pengantar/disklaimer cek diri, isi pustaka rutinitas, deskripsi topik, materi pengetahuan). Daftar lengkapnya di JSON (`jenis: "placeholder"`) sebagai daftar isian untuk psikolog/hukum.
- **Metadata seed** (`"status": "DRAFT"`, `"note"`) dan ID `DRAFT-PLACEHOLDER-*` (menjaga persona contoh tidak cocok dengan psikolog sungguhan).
- **Status konten tetap `draft`**. Menghapus penanda tidak menyetujui konten: di production hanya versi `approved` lewat dashboard (penyetuju ≠ penulis; versi `seed:*` tidak bisa disetujui) yang dipakai.
- **Persona Card yang sudah approved** (`ps-spsyd7hdetvgq`, `ps-psy-uji-lokal-1`) masih memuat `[DRAFT] Pengguna sintetis: …` di contoh few-shot (dari studi kasus lama). Tidak tampil ke pengguna; versi approved tidak diubah. Draft persona berikutnya memakai studi kasus yang sudah bersih.
- **Prompt agent**: tidak ada `[DRAFT]` yang sampai ke model (penanda hanya di komentar HTML yang dibuang dan nama versi `v*-draft`).
- **Dashboard psikolog**: teks bantuan kurasi yang menyebut DRAFT tetap benar untuk placeholder.

## File yang Diubah

- `content/` (15 file): `case-studies/default.json`, `persona-questionnaire/default.json`, `consents/{service,ai-training,legacy-counseling,psikolog-addendum}.json`, `instruments/{checkin-harian,inventori-kepribadian,skrining-draft}.json`, `topics/{tidur,kecemasan,rokok,stres_kerja}.json`, `personas/{draft-reflektif,draft-terstruktur}.json`
- `docs/konten/draft-psikolog.json`, `docs/konten/draft-pengguna.json` (baru)
- Lokal, tidak di-commit: DB `deeptalk_ai_dev` (versi konten baru, nama persona contoh)

## Blocker

Tidak ada baru. Isi placeholder tetap menunggu psikolog dan konsultan hukum (blocker yang sudah ada).

## Rekap Status

- **Selesai:** 5/5
- **Status task:** ✅ Selesai — penanda dihapus dari teks sungguhan; placeholder tetap bertanda sesuai keputusan.
