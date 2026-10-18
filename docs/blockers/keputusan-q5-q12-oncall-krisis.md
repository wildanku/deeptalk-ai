# Keputusan Q5 dan Q12: Tindak Lanjut Krisis dan On-call

**Status:** `OPEN`
**Dibuka:** 2026-10-11 · **Diselesaikan:** —
**Jenis:** keputusan
**Pemilik penyelesaian:** Pak Novri (Q12), psikolog + konsultan hukum (Q5)
**Memblokir:** Phase 6 — alert ke kanal on-call, latihan runbook, exit criteria "on-call engineer dan psikolog sudah ditunjuk dan berlatih runbook krisis"
**Muncul di task:** [20261011-phase-6-hardening-produksi.md](../tasks/20261011-phase-6-hardening-produksi.md)

## Masalah

Runbook sudah ditulis (`docs/runbooks/`), tetapi dua keputusan menahannya menjadi final:
- **Q12:** siapa on-call engineer dan on-call psikolog per periode, jam tanggap, dan kanal (Slack/WhatsApp/telepon) yang menerima alert.
- **Q5:** apa yang dilakukan DeepTalk setelah kejadian krisis (menghubungi pengguna atau tidak, siapa, kapan, dengan dasar hukum apa). Saat ini: tidak ada kontak proaktif; protokol di aplikasi adalah respons resmi.

## Dampak

- `notification_channels` modul monitoring kosong; `ALERT_WEBHOOK_URL` belum ditentukan.
- Latihan runbook dengan orang belum bisa dilakukan.
- Langkah 4 runbook insiden krisis masih placeholder.

## Yang dibutuhkan untuk lepas

- [ ] Q12: daftar on-call (engineer + psikolog), jadwal, target waktu tanggap di dalam dan di luar jam kerja, kanal alert.
- [ ] Q5: kebijakan tindak lanjut (psikolog + hukum).
- [ ] Latihan: minimal satu kali per runbook di `staging` (insiden krisis wajib melibatkan psikolog).

## Riwayat

- 2026-10-11 — dibuka dari task Phase 6.
- 2026-10-14 — task Phase 7: on-call krisis aktif adalah syarat manual tahap 7.1 di `rollout:readiness`; kejadian krisis yang belum ditinjau membuat pemeriksaan gagal.
- 2026-10-14 — task Phase 8: butir keamanan di skrining/check-in mencatat kejadian `layer = instrument` tanpa sesi dan tanpa jawaban, memicu alert crisis yang sama; kebijakan tindak lanjutnya ikut Q5.

## Penyelesaian

—
