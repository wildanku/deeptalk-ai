# Uji Lokal Alur Pengguna Web (Register → Kuota → Chat Teman AI)

**Tanggal:** 2026-10-16
**Phase:** UAT [cek-flow-mvp-151026 §4](../../../docs/deeptalk-ai/cek-flow-mvp-151026.md) langkah 4–7 (sisi pengguna)
**Komponen:** `deeptalk-web-v2` (BFF + proxy), `deeptalk-api-v3` lokal (`feat/ai-phase-1`), gateway, agent (Argon)
**Terkait:** [20261015-uji-lokal-alur-psikolog](20261015-uji-lokal-alur-psikolog.md), [20261016-dev-stack-lokal](20261016-dev-stack-lokal.md)

## Tujuan

Setelah alur psikolog (kuesioner → Persona Card "Mindfulness & Penerimaan" aktif) lulus, memastikan sisi pengguna di web: login/register, mendapat kuota sesi, lalu chat dengan Teman AI dan menerima jawaban yang sesuai.

Keputusan Wildan di sesi ini:
1. v3 lokal memakai **DB baru terpisah** `deeptalk_v3_local` (migrasi v3 + kosong), bukan snapshot `deeptalk`.
2. `AI_ROLLOUT_MODE=all` di v3 lokal.

## Daftar Pekerjaan

- [x] Web lokal diarahkan ke v3 lokal + gateway lokal lewat env proses (`NEXT_PUBLIC_API_URL=http://localhost:3100/v2`, `AI_GATEWAY_URL=http://localhost:8080`); `.env` web tidak diubah
- [x] Temukan penyebab register/login 500 di v3 lokal (lihat Temuan 1)
- [x] DB `deeptalk_v3_local`: `prisma migrate deploy` (20 migrasi), `migrate status` bersih; `.env` v3 diarahkan ke sana (URL lama dibiarkan sebagai komentar untuk rollback), `AI_ROLLOUT_MODE=all`, v3 di-restart
- [x] Register lewat BFF web → sesi di cookie httpOnly (`dt_at`, `dt_rt`); verifikasi email OTP; logout; login; password salah → 422
- [x] `GET /user/ai/availability` → `available: true`; `POST /user/ai/access` → token 900 dtk + transport gateway
- [x] Kuota: `/v1/sessions/current` → 0/10, reset 1 Nov 00:00 WIB; CORS gateway untuk `http://localhost:3000`
- [x] Onboarding: tanggal lahir kosong → `AGE_REQUIRED`; < 18 → `AGE_RESTRICTED`; dewasa → `CONSENT_REQUIRED`; setuju ketentuan v2 → `ready`
- [x] Chat Quick Chat (socket WebSocket-only, meniru `useAiSession`): router memilih persona "Mindfulness & Penerimaan" dengan alasan; kuota 0 → 1 di pesan pertama, tidak bertambah di pesan berikutnya dalam sesi yang sama; balasan streaming; kartu routine `stres_kerja` muncul
- [x] Safety: pesan krisis sintetis → `safety.escalation` crisis < 1 dtk, protokol + kontak (Layanan darurat, SEJIWA), tanpa balasan persona, sesi krisis tidak memotong kuota (kembali 0/10)
- [x] Halaman `/`, `/teman-ai`, `/teman-ai/bantuan`, `/teman-ai/data` → 200; log web tanpa error
- [ ] Cek visual di browser (card beranda, gerbang onboarding, bubble chat) — ekstensi Chrome tidak tersambung di sesi ini; diuji lewat HTTP/socket yang sama dengan browser
- [ ] Kuota habis (11 sesi) dan batas waktu aktif 30 menit — tidak diulang di sini; sudah tercakup E2E `limits` 14/14 (15 Okt)

## Temuan

1. **DB lokal v3 `deeptalk` tidak bisa dipakai alur pengguna.** Isinya snapshot legacy (user terakhir 25 Nov 2025), tanpa `_prisma_migrations`, 0/20 migrasi v3 (mis. `users.google_email`, `booking_outbox` tidak ada). Akibatnya `register` dan `login` (bahkan untuk email yang tidak ada) → 500 tanpa log, dan worker outbox mencatat error tiap 30 dtk. Sisi psikolog tidak terdampak karena login psikolog lewat psikolog-service live. **Diatasi** dengan DB terpisah.
2. **Web lokal (`.env`) mengarah ke v3 live** yang menjawab 404 untuk `/user/ai/*`, jadi Teman AI tidak muncul. Saat ini web :3000 dijalankan dengan env override; `dev-stack.sh up/restart` akan menjalankan web dengan `.env`-nya lagi (kembali ke v3 live).
3. **`AI_ALLOWED_USER_IDS` kosong** dengan `AI_ROLLOUT_MODE=allowlist` → semua pengguna `not_in_rollout`. Diubah ke `all` (lokal).
4. **Teks menempel di satu balasan** ("…yuk.Saat kamu…") — 1 dari 4 balasan; delta streaming pada giliran lain menyambung benar. Penyebab belum dipastikan (keluaran model atau sambungan antar-part di agent, `agents/run.py`).
5. **Latensi token pertama 4,8–9,7 dtk** (token ditahan sampai L2 selesai, sesuai desain); giliran pertama paling lama karena router. Perlu dibandingkan dengan target SLO.
6. **Belum ada menu Teman AI di navigasi web** (masih hanya card beranda) — B3 di cek-flow.
7. Teks consent dan konten masih `[DRAFT]` (sudah diketahui).

## File yang Diubah

**Lokal, tidak di-commit**
- `deeptalk-api-v3/.env`: `DATABASE_URL` → `deeptalk_v3_local` (baris lama dikomentari), `AI_ROLLOUT_MODE=all`
- Postgres lokal: database baru `deeptalk_v3_local`; akun uji sintetis (domain `example.test`)

**deeptalk-ai**
- `docs/tasks/20261016-uji-lokal-alur-pengguna-web.md`

## Validasi

Lihat Daftar Pekerjaan; jawaban AI ditinjau manual: nada empatik, memakai nama panggilan, satu pertanyaan per giliran, langkah bernomor saat diminta, tanpa diagnosis. Isi percakapan uji bersifat sintetis.

## Blocker

Tidak ada blocker baru.

## Follow-up

- Putuskan apakah `dev-stack.sh` menjalankan web dengan v3 lokal + gateway lokal secara default (Temuan 2).
- Selidiki Temuan 4 bila berulang.
- B3: menu Teman AI di navbar web.
- Cek visual di browser oleh Wildan.

## Rekap Status

- **Selesai:** 10/12
- **Belum:** cek visual browser; kuota habis / batas waktu aktif (tercakup E2E)
- **Status task:** ✅ Selesai untuk cakupan yang diminta (register/login → kuota → chat dengan jawaban sesuai); dua cek tambahan di atas belum.

- Lanjutan: rekomendasi psikolog di chat → [20261016-rekomendasi-psikolog](20261016-rekomendasi-psikolog.md).
