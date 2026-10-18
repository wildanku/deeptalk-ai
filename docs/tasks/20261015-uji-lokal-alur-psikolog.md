# Uji Lokal Alur Psikolog (Kuesioner → Persona) dengan Argon

**Tanggal:** 2026-10-15
**Phase:** Phase 5 (portal psikolog) — UAT [cek-flow-mvp-151026 §4](../../../docs/deeptalk-ai/cek-flow-mvp-151026.md)
**Komponen:** agent, gateway, `psikolog-deeptalk-dashboard`, `deeptalk-api-v3` (dijalankan saja), psikolog-service live

## Tujuan

Memastikan tidak ada blocker di sisi psikolog untuk mengisi kuesioner dan studi kasus yang menjadi referensi AI (Persona Card), lalu menjalankan deeptalk-ai dan dashboard secara lokal dengan psikolog-service live (`https://api-psikolog.lgs.web.id`).

Keputusan Wildan di sesi ini:
1. Dashboard mendapat env khusus `AI_ACCESS_API_URL` untuk penerbit token AI; fitur lain tetap ke v3 live.
2. `SUPERADMIN_LOGOS_CLIENT`/`SECRET` v3 lokal diisi Wildan sendiri.
3. psikolog-service live = `api-psikolog.lgs.web.id`.

## Daftar Pekerjaan

- [x] Audit blocker alur psikolog (kode, konten, konfigurasi). **Tidak ada blocker di kode.** Syarat alurnya sesuai desain: kuesioner lengkap, ≥ 1 studi kasus contoh, 5 kasus evaluasi, run evaluasi dinilai aman. Konten kuesioner dan studi kasus DRAFT, terpakai dengan `CONTENT_ALLOW_DRAFT=true` (lokal)
- [x] Uji agent dengan Argon: draft Persona Card (6,8 dtk) dan run evaluasi 5 kasus (25,5 dtk), sintetis
- [x] Dashboard: `AI_ACCESS_API_URL` (server-only di `lib/ai-token.ts`, default `DEEPTALK_API_URL`) + `.env.example` + README; `.env` lokal mengarah ke v3 lokal dan gateway lokal
- [x] v3 lokal cabang `feat/ai-phase-1` (salinan build di scratchpad; checkout `deploy/prod` tidak dipindah), `.env` dengan kunci ES256 lokal, port 3100
- [x] Gateway lokal: `.env`, migrasi `deeptalk_ai_dev` (sudah terbaru), seed konten (39 tidak berubah)
- [x] Jalankan agent (8000, Argon), gateway (8080), v3 (3100), dashboard (3001); cek health, JWKS, BFF
- [x] Alur psikolog lengkap lewat gateway dengan token psikolog sintetis bertanda tangan kunci v3 lokal: kuesioner → studi kasus → draft (Argon, 7,9 dtk) → evaluasi 5 kasus (40 dtk) → penilaian → persetujuan → `active` → dinonaktifkan lagi
- [x] Kredensial service v3 → psikolog-service: atas persetujuan Wildan, `SUPERADMIN_LOGOS_*` diisi dengan kredensial Logos yang sama dengan dashboard (diuji dulu: diterima `/profile`). v3 lokal kini menolak token palsu dengan "Invalid or expired token", bukan "service unavailable"
- [x] Login psikolog sungguhan di browser → token AI dari v3 lokal (16 Okt: log dashboard `/api/ai/psikolog/me` dan `persona/status` → 200)
- [x] Panduan uji di browser untuk psikolog (di bawah)

## Panduan uji di browser

1. Isi `SUPERADMIN_LOGOS_CLIENT` dan `SUPERADMIN_LOGOS_SECRET` di `deeptalk-api-v3/.env`, lalu restart v3 lokal.
2. Buka `http://localhost:3001`, login dengan akun psikolog **terverifikasi** di psikolog-service live.
3. Beranda → card "Persona DeepTalk AI Anda" (Belum dimulai) → menu Teman AI → Persona saya.
4. Isi kuesioner → jawab studi kasus contoh dan 5 studi kasus evaluasi → Buat draft.
5. Koreksi bila perlu → jalankan evaluasi → nilai tiap respons → setujui versi → status aktif.

## File yang Diubah

**psikolog-deeptalk-dashboard**
- `lib/ai-token.ts` — `AI_ACCESS_API_URL`
- `.env.example`, `README.md`
- Lokal, tidak di-commit: `.env` (tambah `NEXT_PUBLIC_AI_GATEWAY_URL`, `AI_ACCESS_API_URL`)

**Lokal, tidak di-commit**
- `deeptalk-api-v3/.env`, `deeptalk-ai/gateway/.env` (dibuat dengan rahasia acak; tidak ditampilkan)

**deeptalk-ai**
- `docs/tasks/20261015-uji-lokal-alur-psikolog.md`

## Keputusan

- **Penerbit token AI dipisah lewat env server-only.** Psikolog bisa memakai data live (Beranda, booking) sementara token AI diterbitkan v3 lokal yang sudah punya modul AI. Default tetap `NEXT_PUBLIC_DEEPTALK_API_URL`, jadi tanpa env ini perilaku tidak berubah.
- **v3 dijalankan dari salinan build**, bukan memindah cabang checkout pengguna.
- **Persona uji sintetis dinonaktifkan setelah disetujui**, agar tidak ditawarkan ke pengguna uji berikutnya.

## Validasi

- Dashboard: `tsc --noEmit` dan `eslint` bersih; `/login` 200; BFF `/api/ai/...` tanpa sesi → 401 `SESSION_REQUIRED`.
- v3 lokal: JWKS 200 (`local-1`, EC P-256). `POST /v2/psikolog/ai/access` dengan token palsu → "Psikolog authentication service is unavailable", karena psikolog-service live menolak kredensial `SUPERADMIN_*` yang masih berupa penanda. Ini juga membuktikan v3 sudah tersambung ke psikolog-service live.
- Gateway: token psikolog dari kunci v3 lokal diterima (`/psikolog/me` → roles `psikolog`); seluruh alur persona lulus dengan Argon (lihat Daftar Pekerjaan).
- Masalah saat menjalankan v3: Prisma client belum di-generate di salinan build, dan `tsbuildinfo` membuat `nest build` hanya menghasilkan `.d.ts`. Diatasi dengan `prisma generate` dan menghapus `tsconfig.build.tsbuildinfo`.

## Blocker

Tidak ada blocker baru. Langkah login sungguhan menunggu kredensial dari Wildan (tindakan di sesi ini, bukan blocker eksternal).

## Follow-up

- Login psikolog sungguhan di browser (panduan di atas).
- Menu Teman AI di dashboard bergantung pada token AI. Dengan v3 live (tanpa modul AI), menu itu tidak muncul sampai `feat/ai-phase-1` di-merge dan dirilis ([uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md)).

## Rekap Status

- **Selesai:** 10/10
- **Belum:** —
- **Status task:** ✅ Selesai — lanjutan (satu perintah stack + panduan kuesioner) di [20261016-dev-stack-lokal](20261016-dev-stack-lokal.md).
