# Runbook: Respons AI Tidak Aman

**Pemicu:** laporan pengguna ("Laporkan respons" di web/app → dashboard Tinjauan keamanan), laporan psikolog, metrik `message_reported` naik, atau L3 sering mengganti respons (`ai_turn replaced=true`).

## Langkah

1. **Triase** (reviewer klinis, harian; segera bila alasan `harmful`): buka laporan di dashboard. Teks respons AI hanya tampil bila pengguna mengizinkan; pesan pengguna tidak pernah tampil.
2. **Berbahaya dan bisa terulang?** Psikolog pemilik persona (atau reviewer) **menonaktifkan persona** di dashboard → berlaku pada giliran berikutnya di semua sesi berjalan; pengguna dialihkan ke pendekatan lain.
3. **Bila tidak terkait satu persona** (aturan global, model): engineer mempertimbangkan rollback revisi agent atau prompt (`ACTIVE` di `agent/prompts/__init__.py`), atau menghentikan Teman AI (v3 `AI_ROLLOUT_MODE=off`).
4. **Analisis:** model dan versi prompt ada di setiap pesan (`ai_messages.model`, `prompt_version`) dan di laporan. Persona dan versinya ada di laporan.
5. **Perbaikan:** konten (Persona Card versi baru → evaluasi ulang → setujui), frasa L1, pola L3 (`agents/safety.py`), atau prompt global. Tambahkan studi kasus sintetis yang mereproduksi masalah ke set evaluasi.
6. **Aktifkan lagi** hanya setelah evaluasi ulang lulus (semua respons dinilai aman) — gerbang `eval:personas` di pipeline juga memeriksanya.
7. Catat tinjauan di laporan (catatan tinjauan) dan buat catatan insiden.

## Latihan

Lokal: `e2e/run.sh phase4-5` (menonaktifkan persona di tengah sesi; laporan respons). `staging`: psikolog melaporkan respons uji dan menonaktifkan personanya sendiri dari dashboard.
