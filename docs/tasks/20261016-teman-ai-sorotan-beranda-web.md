# Teman AI sebagai Fitur Sorotan di Web (termasuk Tamu)

**Tanggal:** 2026-10-16
**Komponen:** `deeptalk-web-v2`
**Terkait:** cek-flow-mvp-151026 B3 (pintu masuk Teman AI di web)

## Tujuan

Teman AI menjadi fitur yang disorot di beranda web, juga untuk pengunjung yang belum login, dan `/teman-ai` untuk tamu menjelaskan fitur-fiturnya agar tertarik masuk dan mencoba.

## Daftar Pekerjaan

- [x] Hero (tamu): badge "Baru · Teman AI — teman bicara 24/7" (menggulir ke `#teman-ai`), CTA utama "Coba Teman AI", "Mulai konseling" jadi tombol kedua, "Buat akun gratis" jadi tautan teks
- [x] Section `TemanAiSpotlight` setelah hero, untuk semua pengunjung (dirender server untuk tamu): judul, poin keunggulan, pratinjau percakapan berlabel "Contoh percakapan", kartu fitur. CTA mengikuti pengunjung: tamu → coba/daftar; dalam rollout → "Mulai ngobrol"; login tapi belum rollout → "sedang dibuka bertahap"; tanpa CTA selama status login dimuat. Menggantikan `TemanAiCard` (sebelumnya hanya untuk anggota rollout)
- [x] Landing tamu `/teman-ai` (`TemanAiGuestLanding`, dipakai `TemanAiGate`): hero + pratinjau, 8 fitur (kapan pun, pendekatan psikolog, rekomendasi psikolog, Daily Routine, cek diri, riwayat per sesi, privasi, aman saat genting), 3 langkah, CTA "Masuk untuk mencoba" (kembali ke `/teman-ai` lewat `?next=`) dan "Daftar gratis", tautan bantuan darurat tanpa login
- [x] Klaim hanya fitur yang ada; "AI, bukan psikolog" di setiap section; pratinjau ditandai contoh
- [x] Copy `id.json`/`en.json` (`home.hero.*`, `temanAi.showcase`, `temanAi.guest`); kunci tak terpakai dihapus (`home.temanAiCard`, `home.hero.badge`, `temanAi.chat.guestTitle/guestBody`)
- [x] typecheck, lint (0 error; 2 peringatan lama), vitest (128), build; `/`, `/teman-ai`, `/teman-ai/baru` 200 untuk tamu dan anggota tanpa error baru
- [ ] Cek visual desktop/mobile di browser — belum: ekstensi Chrome tidak tersambung

## File yang Diubah (deeptalk-web-v2)

- `src/components/home/home-hero.tsx`, `teman-ai-spotlight.tsx` (baru), `teman-ai-card.tsx` (dihapus)
- `src/components/teman-ai/teman-ai-showcase.tsx` (baru), `teman-ai-guest-landing.tsx` (baru), `teman-ai-gate.tsx`
- `src/app/[lang]/page.tsx`
- `lang/id.json`, `lang/en.json`

## Catatan

- Register belum mendukung `?next=`: pengguna baru melewati verifikasi email lalu beranda (section sorotan menyambut di sana).
- Teman AI masih rollout bertahap: tamu yang mendaftar tetapi belum masuk rollout melihat "sedang dibuka bertahap", bukan tombol yang menjanjikan akses.

## Rekap Status

- **Selesai:** 6/7
- **Belum:** cek visual browser
- **Status task:** ✅ Selesai — tampilan belum dilihat di browser.
