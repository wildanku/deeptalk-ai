# Uji Client Web dan App ke v3 yang Berjalan

**Status:** `OPEN`
**Dibuka:** 2026-10-08 · **Diselesaikan:** —
**Jenis:** lintas-repo
**Pemilik penyelesaian:** Wildan
**Memblokir:** checklist Phase 1 "Web/App: hook sesi AI + layar chat minimal" (verifikasi), exit criteria #1; Phase 2–3: UI persona/kuota/krisis, layar bantuan app offline, kartu routine/asesmen/handoff, layar Rutinitas, tautan handoff ke booking; Phase 4: gerbang usia/consent, "Persetujuan & data"; Phase 5: dashboard psikolog (login nyata) dan push handoff di psikolog-app-v2
**Muncul di task:** [20261008-phase-1-fondasi-platform.md](../tasks/20261008-phase-1-fondasi-platform.md), [20261010-phase-2-3-percakapan-keamanan-output.md](../tasks/20261010-phase-2-3-percakapan-keamanan-output.md), [20261010-phase-4-5-consent-data-portal-psikolog.md](../tasks/20261010-phase-4-5-consent-data-portal-psikolog.md)

## Masalah

Layar `/teman-ai` (web) dan `teman-ai` (app) sudah dibangun dan lolos typecheck, lint, test, dan build/bundle, tetapi belum pernah dijalankan ke v3 yang sungguhan. Untuk itu `deeptalk-api-v3` branch `feat/ai-phase-1` harus berjalan di lingkungan development dengan token exchange AI dikonfigurasi, dan dibutuhkan akun pengguna uji di allowlist. Definition of Done web §8 mewajibkan uji terhadap API yang berjalan.

## Dampak

Alur client (login → availability → token → socket → balasan → refresh token → reconnect saat deploy) belum terbukti ujung ke ujung dari UI.

## Yang dibutuhkan untuk lepas

- [ ] Deploy `deeptalk-api-v3` `feat/ai-phase-1` ke dev, dengan `AI_JWT_PRIVATE_KEY`, `AI_JWT_KID`, `AI_GATEWAY_PUBLIC_URL`, `AI_SERVICE_TOKEN`, `AI_ROLLOUT_MODE=allowlist`, `AI_ALLOWED_USER_IDS=<akun uji>` (lihat `docs/guidance/ai-token-exchange.md` di v3).
- [ ] Gateway dan agent yang bisa dijangkau dari web/app dev: lokal (`localhost`, untuk simulator/web) atau `dev` GCP ([lingkungan-gcp-dev](lingkungan-gcp-dev.md)). Gateway `CORS_ORIGINS` memuat origin web.
- [ ] Akun pengguna uji.
- [ ] Uji: pengguna di luar allowlist melihat "belum tersedia"; pengguna allowlist bisa bercakap; matikan satu instance gateway saat balasan berjalan → UI reconnect dan balasan muncul.
- [ ] Phase 2–3: v3 juga butuh `AI_GATEWAY_INTERNAL_URL` dan `AI_GATEWAY_WEBHOOK_TOKEN`; gateway butuh `CONTENT_ALLOW_DRAFT=true` dan seed `content:seed` di non-production.
- [ ] Uji Phase 2–3 di web dan app: pilih persona/Quick Chat, label dan sisa kuota, peringatan/akhir sesi, panel krisis (pesan sintetis), `/teman-ai/bantuan` tanpa login, layar bantuan app saat offline, kartu routine (terima/ubah/tolak) → layar Rutinitas, kartu asesmen → deep link, kartu handoff → profil psikolog → booking → tautan/konfirmasi ulang, push pengingat routine membuka `/teman-ai/rutinitas`.

## Riwayat

- 2026-10-08 — dibuka dari task Phase 1.
- 2026-10-10 — cakupan diperluas oleh task Phase 2–3 (UI baru di web dan app).
- 2026-10-11 — cakupan diperluas oleh task Phase 4–5: web/app (isi tanggal lahir lewat profil v3, consent, tawaran consent pelatihan, hapus riwayat), dashboard (login psikolog nyata → BFF `app/api/ai` → semua halaman Teman AI; BFF sudah diuji dengan v3 tiruan), psikolog-app-v2 (push `teman_ai_handoff` di perangkat: foreground, background, killed). v3 butuh juga `POST /v2/psikolog/ai/access` untuk akun psikolog uji dan `AI_ROLLOUT_MODE` ≠ `off`.
- 2026-10-14 — cakupan diperluas oleh task Phase 7: kartu Teman AI di beranda web/app (muncul hanya bila `GET /user/ai/availability` → `available`) dan pencatatan kartu asesmen dibuka (`POST /v1/assessments/referrals/:id/opened`). Catatan: checkout v3 lokal kini di `deploy/prod` (tanpa modul AI); uji ke v3 dev butuh build cabang `feat/ai-phase-1` atau hasil merge-nya.
- 2026-10-14 — cakupan diperluas oleh task Phase 8: halaman Cek diri (web `/teman-ai/cek-diri`, app `teman-ai/cek-diri`), tawaran inventori, filter topik persona, hapus data cek diri, dashboard Cakupan.
- 2026-10-14 — cakupan diperluas oleh task Phase 9: consent riwayat konseling di halaman Persetujuan & data (web/app), dashboard "Penggunaan data" (addendum psikolog) dan "Data pelatihan" (`data_reviewer`).
- 2026-10-15 — topologi deployment: v3 berjalan di VM GCE + Dokploy dalam proyek GCP yang sama dengan gateway ([topologi](../../../docs/deeptalk-ai/topologi-deployment-151026.md) §3.3, §9.3). `feat/ai-phase-1` bisa di-merge ke `deploy/prod` tanpa konflik (1 commit di depan, 7 di belakang); merge dan rilisnya menunggu review pemilik v3. Tanpa itu, deploy v3 di Dokploy tetap tanpa modul AI.

## Penyelesaian

—
