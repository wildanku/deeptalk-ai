# Ruang per Sesi, Akhiri Sesi, dan Beranda Teman AI (web)

**Tanggal:** 2026-10-16
**Phase:** UAT [cek-flow-mvp-151026 §4](../../../docs/deeptalk-ai/cek-flow-mvp-151026.md) (permintaan Wildan setelah uji sisi pengguna)
**Komponen:** gateway, `deeptalk-web-v2`
**Terkait:** [20261016-rekomendasi-psikolog](20261016-rekomendasi-psikolog.md)

## Tujuan

1. Setiap sesi Teman AI punya ruang sendiri di `/teman-ai/:id`, dengan tombol untuk mengakhiri sesi. "Chat baru" membuka ruang baru.
2. `/teman-ai` menjadi beranda Teman AI: mulai/lanjutkan chat, riwayat sesi, alat (rutinitas, cek diri, bantuan), dan pengaturan (consent, memori, data).
3. Header chat lebih sederhana dan modern.

Batasan yang dipertahankan: satu sesi aktif per pengguna, kuota dihitung saat pesan pertama (02 §6.3). Karena itu ID ruang adalah ID sesi dari server: "Chat baru" membuka `/teman-ai/baru`, lalu URL diganti ke `/teman-ai/<session_id>` setelah pesan pertama tercatat (tanpa memuat ulang halaman). UUID buatan client tidak dipakai, karena sesi yang belum berisi pesan tidak boleh memotong kuota.

## Daftar Pekerjaan

### Gateway
- [x] `GET /v1/sessions` — riwayat sesi milik pengguna yang masih punya pesan (paginasi `before`, 20 per halaman), pratinjau pesan pertama (≤ 90 karakter) dan label persona
- [x] `GET /v1/sessions/:id` — detail + transkrip (maks. 200 pesan) satu sesi milik sendiri; selain itu 404, ID bukan UUID 400
- [x] `POST /v1/sessions/:id/end` — alasan baru `user_ended` (migrasi `…_session_end_reason_user`: `ALTER TYPE … ADD VALUE`, hanya DB lokal); idempoten
- [x] `MessagesService.firstUserMessages()` untuk judul sesi
- [x] Spec `sessions.controller.spec.ts` (4)
- [x] lint, typecheck, test (41 suite / 285 test), test:e2e (2), build

### Web
- [x] Klien API (`sessions`, `session`, `endSession`) + tipe `AiSessionSummary`/`AiSessionDetail`
- [x] Rute `/teman-ai/[id]` (`baru` = sesi baru); `/teman-ai` = beranda
- [x] Ruang chat: live bila sesi terbuka, transkrip baca-saja bila berakhir, "tidak ditemukan" untuk ID asing/bukan UUID
- [x] Ruang baru: URL berganti ke `/teman-ai/<session_id>` lewat `history.replaceState` setelah pesan pertama (tanpa remount)
- [x] Tombol "Akhiri" + `ConfirmDialog` berbasis `<dialog>` native (fokus terkunci, Escape, fokus kembali ke pemicu, klik backdrop)
- [x] Sesi aktif di tab/perangkat lain saat membuka "Chat baru": "Lanjutkan sesi" atau "Akhiri & mulai baru"
- [x] Header baru: kembali, avatar + status (titik hijau), persona + label AI, status kuota/menyambungkan/berakhir, bantuan darurat (ikon merah), "Akhiri"; alasan router dan peringatan waktu jadi catatan sistem di transkrip; composer berbentuk pil, gelembung pengguna bergradien, indikator mengetik
- [x] Beranda: hero (sapaan, kuota + progress bar + tanggal reset, "Mulai chat baru" / "Lanjutkan sesi" + tombol chat baru), riwayat sesi (muat lebih banyak), "Lainnya" (Daily Routine, Cek diri, Bantuan darurat), "Pengaturan & privasi" (`DataSettingsPanel`: consent, memori, hapus riwayat, hapus cek diri)
- [x] `/teman-ai/data` → redirect 307 ke `/teman-ai#pengaturan`; tautan lama diperbarui (rutinitas → `/teman-ai/baru`, cek diri → `#pengaturan`); hapus riwayat menyegarkan beranda
- [x] Copy `temanAi.room`, `temanAi.home`, `meta.room`, `endedCopy.user_ended` di `id.json`/`en.json`; kunci lama yang tak terpakai dihapus
- [x] typecheck, lint (0 error; 2 peringatan lama di `footer.tsx` dan service worker), vitest (128), build
- [ ] Cek visual + DoD responsif (360/768/1280/1920 px) dan keyboard di browser — belum: ekstensi Chrome tidak tersambung di sesi ini

### Dokumen dan verifikasi
- [x] 02 §6.2 (`session.ended` + `user_ended`), §6.2a (tiga endpoint)
- [x] Uji lokal (socket + REST seperti web, 9/9 lulus): pesan pertama di ruang baru membuat sesi → akhiri → `session.ended` `user_ended` → akhiri lagi 204 → riwayat menampilkan sesi teratas dengan judul → transkrip 2 pesan → tidak ada sesi terbuka. Halaman `/teman-ai`, `/teman-ai/baru`, `/teman-ai/<id>`, `/teman-ai/bukan-uuid` → 200 tanpa error di log
- [ ] App (`deeptalk-app-v2`) — belum: di luar permintaan ini

## File yang Diubah

**deeptalk-ai/gateway**
- `prisma/schema.prisma`, `prisma/migrations/*_session_end_reason_user/`
- `src/sessions/sessions.controller.ts`, `sessions.controller.spec.ts` (baru), `sessions.service.ts` (`EndReason`)
- `src/messages/messages.service.ts`

**deeptalk-ai/docs**
- `02-implementasi.md`, `tasks/20261016-ruang-sesi-dan-beranda-teman-ai.md`

**deeptalk-web-v2**
- `src/app/[lang]/teman-ai/page.tsx`, `[id]/page.tsx` (baru), `data/page.tsx`
- `src/components/teman-ai/teman-ai-chat.tsx` (ruang chat, ditulis ulang), `teman-ai-home.tsx` (baru), `teman-ai-gate.tsx` (baru), `data-settings.tsx` (dari `data-settings-screen.tsx`), `routines-screen.tsx`, `self-check-screen.tsx`
- `src/components/ui/confirm-dialog.tsx` (baru)
- `src/lib/api/ai.ts`, `src/lib/domain/ai.ts`
- `lang/id.json`, `lang/en.json`

## Keputusan

- **ID ruang = ID sesi dari server**, bukan UUID client: kuota dihitung saat pesan pertama, jadi ruang tanpa pesan tidak boleh membuat sesi. `/teman-ai/baru` berganti URL setelah sesi tercipta.
- **Satu sesi aktif tetap dipertahankan.** "Chat baru" saat sesi lain berjalan meminta konfirmasi untuk mengakhirinya dulu (dari beranda maupun ruang baru).
- **Transkrip sesi lama baca-saja**; melanjutkan percakapan = chat baru (memori lintas sesi tetap membawa konteks).
- **Pengaturan pindah ke beranda** agar semua hal Teman AI di satu tempat; `/teman-ai/data` tetap hidup sebagai redirect untuk tautan lama.
- **Bantuan darurat tetap satu ketukan di header chat** (ikon merah), sedangkan rutinitas dan cek diri pindah ke beranda.

## Blocker

Tidak ada.

## Follow-up

- Cek visual dan DoD responsif/keyboard di browser oleh Wildan.
- App (`deeptalk-app-v2`): pola ruang per sesi, akhiri sesi, dan beranda yang sama.
- Pertimbangkan pratinjau yang tidak memuat isi pesan bila perangkat dipakai bersama (mis. opsi "sembunyikan judul sesi").

## Rekap Status

- **Selesai:** 19/21
- **Belum:** cek visual browser; app
- **Status task:** ✅ Selesai untuk web — ruang per sesi, akhiri sesi, beranda, dan header baru berjalan di stack lokal; tampilan belum dilihat di browser.
