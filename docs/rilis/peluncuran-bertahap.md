# Playbook Peluncuran Bertahap Teman AI

Untuk Pak Novri (keputusan tiap tahap), Wildan (eksekusi), dan psikolog on-call. Setiap tahap dibuka **berdasarkan data, bukan tanggal** (03 Phase 7). Strategi tahap: Q3 (usulan di bawah).

## Kontrol rollout

Teman AI dibuka per akun oleh deeptalk-api-v3, tanpa rilis web/app: pintu masuk di beranda dan layar `/teman-ai` hanya tampil bila `GET /v2/user/ai/availability` → `available: true`.

| Variabel v3 | Nilai | Arti |
|---|---|---|
| `AI_ROLLOUT_MODE` | `off` → `allowlist` → `percentage` → `all` | Tahap aktif |
| `AI_ALLOWED_USER_IDS` | daftar ID | Tahap internal dan beta |
| `AI_ROLLOUT_PERCENT` | 5 → 25 → 50 | Tahap bertahap; bucket stabil per pengguna |

Mundur satu tahap kapan saja = ubah variabel yang sama. Darurat: `AI_ROLLOUT_MODE=off` (sesi berjalan berhenti paling lambat 15 menit kemudian; bantuan darurat tetap tersedia).

## Sebelum setiap kenaikan

1. `DATABASE_URL=<read-only prod> pnpm run rollout:readiness -- --stage <tahap>` di `gateway/` — semua cek otomatis **PASS**: protokol `crisis`/`elevated`, frasa L1, teks consent layanan `approved`; setiap persona aktif lolos evaluasi; tidak ada kejadian `crisis` atau laporan "berbahaya" yang belum ditinjau.
2. Cek manual yang dicetak skrip itu, dicatat di tinjauan pasca-tahap.
3. Dashboard monitoring: SLO 7 hari terakhir ([slo.md](../slo.md)); dashboard psikolog → **Dampak**: indikator Konsep §8.
4. Tinjauan pasca-tahap sebelumnya sudah ditulis ([template](tinjauan-pasca-tahap-template.md)) dan tindak lanjutnya selesai atau dijadwalkan.

## Tahap

| Tahap | Siapa | Setelan v3 | Syarat naik (03 Phase 7) | Lama minimum (usulan) |
|---|---|---|---|---|
| 7.1 Internal | Tim DeepTalk + psikolog | `allowlist` | Tidak ada insiden safety terbuka; umpan balik psikolog ditindaklanjuti | 2 minggu |
| 7.2 Beta tertutup | Pengguna terpilih yang mendaftar | `allowlist` (+ akun beta) | SLO terpenuhi; tinjauan sampel percakapan **dengan consent** tanpa temuan kritis | 4 minggu |
| 7.3 Bertahap | 5% → 25% → 50% | `percentage` | Di setiap kenaikan: SLO dan biaya per sesi stabil; uji beban untuk tahap berikutnya lulus | 2 minggu per langkah |
| 7.4 GA | Semua | `all` | Keputusan bersama Pak Novri dan Wildan | — |

**Exit Phase 7:** `AI_ROLLOUT_MODE=all` dan dua siklus kuota bulanan penuh di GA tanpa insiden safety terbuka.

## Catatan per tahap

- **Internal:** psikolog mencoba persona mereka sendiri dan menilai lewat "Laporkan respons" / Tinjauan keamanan. Isi percakapan internal tetap tidak dibaca tanpa izin.
- **Beta:** pendaftaran beta belum ada sebagai fitur — daftar ID dikelola manual di `AI_ALLOWED_USER_IDS` (batas praktis ratusan akun; v3 tidak boleh menambah tabel). Tinjauan sampel percakapan membutuhkan kebijakan dan consent tersendiri (Q5) — sampai ada, tinjauan memakai laporan respons yang dibagikan pengguna dan evaluasi persona.
- **Bertahap:** naikkan persentase di awal minggu kerja, bukan menjelang libur; pantau 48 jam pertama.
- **GA:** komunikasi publik memakai [materi komunikasi](materi-komunikasi.md); klaim di luar daftar itu tidak dipakai.
