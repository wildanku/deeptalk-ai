# Rapikan Layout Semua Halaman DeepTalk AI (Mobile & Desktop)

**Tanggal:** 2026-10-16
**Komponen:** `deeptalk-web-v2`
**Terkait:** [20261016-teman-ai-sorotan-beranda-web](20261016-teman-ai-sorotan-beranda-web.md)

## Tujuan

Hilangkan offset di semua rute `/deeptalk-ai` (beranda sampai ruang chat), di mobile maupun desktop.

## Metode

Audit dengan Chrome headless lewat DevTools Protocol (tanpa paket tambahan), sesi akun uji dan tamu: tiap halaman × lebar 360/390/768/1280 px → screenshot + daftar elemen yang melewati viewport + `scrollWidth − clientWidth`.

**Temuan awal**
- Beranda `/deeptalk-ai` melebar 402 px di 360 px (10 px di 768 px): grid riwayat (`min-width: auto`) ikut selebar judul sesi yang panjang, sehingga header situs pun terdorong.
- Tepi kiri dan lebar tiap halaman berbeda di desktop: beranda 176 px/1024, Rutinitas & Cek diri 88 px/penuh, Bantuan 328 px/720, ruang chat header 0 px vs isi di tengah.
- Ruang chat: judul header (label persona panjang) terpotong di mobile; ruang baru langsung tergulir ke bawah sehingga sambutan dan pemilih pendekatan terlewat.
- Cek diri: kartu tren kosong (bar putih) tampil walau belum ada data; satu kartu per kelompok hanya setengah lebar.
- Sub-halaman tanpa jalan kembali ke beranda DeepTalk AI.

## Daftar Pekerjaan

- [x] `DeepTalkAiPage`: satu lebar (max 1024 px) dan tepi kiri untuk semua halaman DeepTalk AI di luar ruang chat, heading seragam, tautan "← Beranda DeepTalk AI"; dipakai Rutinitas, Cek diri, isi Cek diri (form tetap max 672 px), Bantuan (max 768 px), landing tamu
- [x] Beranda: `grid-cols-1` + `min-w-0` → judul sesi terpotong rapi
- [x] Ruang chat: isi header di kolom yang sama dengan percakapan; judul "DeepTalk AI" + label AI, pendekatan pindah ke subjudul; ruang baru mulai dari atas (auto-scroll hanya untuk ruang yang sudah ada / setelah mengirim)
- [x] Cek diri: kartu tren hanya bila ada data; dua kolom hanya bila kelompok punya > 1 kartu
- [x] Audit ulang: 0 px overflow dan 0 elemen keluar viewport di 7 halaman anggota × 4 lebar, landing tamu dan beranda situs × 4 lebar; screenshot dicek
- [x] typecheck, lint (0 error; 2 peringatan lama), vitest (128), build

## File yang Diubah (deeptalk-web-v2)

- `src/components/teman-ai/deeptalk-ai-page.tsx` (baru)
- `src/components/teman-ai/teman-ai-chat.tsx`, `teman-ai-home.tsx`, `teman-ai-guest-landing.tsx`, `routines-screen.tsx`, `self-check-screen.tsx`, `instrument-screen.tsx`
- `src/app/[lang]/deeptalk-ai/bantuan/page.tsx`
- `lang/id.json`, `lang/en.json` (`temanAi.nav.home`)

## Rekap Status

- **Selesai:** 6/6
- **Status task:** ✅ Selesai — diverifikasi dengan screenshot headless (bukan perangkat fisik; safe-area iOS belum diuji di perangkat).
