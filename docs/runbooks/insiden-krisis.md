# Runbook: Insiden Krisis

**Pemicu:** alert `ai_crisis` (setiap kejadian `crisis`), atau laporan bahwa pengguna dalam bahaya.

Yang sudah dilakukan sistem secara otomatis, tanpa menunggu manusia:
- Respons persona dibatalkan; pengguna menerima protokol krisis dari psikolog (kontak darurat, tombol telepon). Pesan krisis tidak pernah ditolak oleh kuota, rate limit, atau gerbang consent/usia.
- Sesi ditandai `crisis` (lengket), tidak dihitung kuota, tidak ditutup oleh batas waktu, dikeluarkan dari data pelatihan.
- Kejadian dicatat di `ai_safety_events` tanpa isi pesan.

## Langkah

1. **Akui alert** di kanal on-call dalam 15 menit (jam kerja) — target di luar jam kerja **[Q12]**.
2. **Pastikan protokol terkirim.** Di Cloud Logging cari `jsonPayload.metric="crisis_protocol_sent"` untuk waktu yang sama dengan `crisis_detected`. Bila ada `crisis_detected` tanpa `crisis_protocol_sent` → ini insiden **SEV-1** (SLO 100%): eskalasi engineering sekarang, lanjut ke langkah 6.
3. **Tinjau kejadian** di dashboard → Tinjauan keamanan (lapis, sinyal, persona). Isi percakapan tidak tersedia.
4. **Tindak lanjut ke pengguna** — **[Q5]**: apakah DeepTalk menghubungi pengguna, siapa, dan dalam kondisi apa, diputuskan psikolog dan hukum. Sampai diputuskan: tidak ada kontak proaktif; protokol di aplikasi adalah respons resmi.
5. **Catat tinjauan** di kejadian itu (catatan tinjauan) dan tutup alert.
6. **Bila protokol tidak terkirim atau sistem tidak bisa menjawab:**
   - Cek kesehatan: `GET /v1/health` gateway, log `AGENT_UNAVAILABLE`.
   - L1 tetap jalan walau agent mati; bila gateway sendiri mati, ikuti [gangguan-vertex-ai](gangguan-vertex-ai.md) §Gateway.
   - Bila perlu menghentikan Teman AI: v3 `AI_ROLLOUT_MODE=off`. Halaman bantuan web (`/teman-ai/bantuan`) dan layar bantuan app (offline) tetap tersedia.

## Latihan

Simulasi dengan pesan sintetis di `staging`: kirim frasa krisis dari daftar L1 → pastikan alert sampai ke kanal, protokol tampil di web dan app, kejadian muncul di dashboard. Latihan teknis lokal: `e2e/run.sh phase2-3` (krisis L1 dan L2), `resilience` (agent mati), `phase4-5` (krisis sebelum consent/usia).
