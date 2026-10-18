# Latensi L2 dengan Gemini 4 Argon Melewati `SAFETY_TIMEOUT_MS`

**Status:** `OPEN`
**Dibuka:** 2026-10-15 · **Diselesaikan:** —
**Jenis:** keputusan
**Pemilik penyelesaian:** Wildan (dengan masukan kepala klinis untuk dampak `elevated`)
**Memblokir:** percakapan normal di dev/prod dengan Argon (hampir semua pesan jatuh ke `elevated`); SLO waktu token pertama p95 ≤ 4 dtk (02 §12.2)
**Muncul di task:** [20261015-uji-lokal-gemini-4-argon.md](../tasks/20261015-uji-lokal-gemini-4-argon.md)

## Masalah

`uv run python -m evals.smoke_model` dari laptop (Jakarta → `us`, proyek trial) mengukur L2 (`/v1/safety/classify`, Argon thinking `LOW`) di **2,6–4,2 detik**. Default `SAFETY_TIMEOUT_MS` adalah 3.000. Bila L2 timeout, agent menganggap pesan `elevated` (gagal tertutup, 02 §7.2), jadi dengan default ini hampir semua pesan diperlakukan berisiko meningkat.

Klasifikasinya sendiri tepat pada pesan uji sintetis: kalimat krisis → `crisis`, keluhan kerja → `normal`.

## Dampak

- Dengan 3.000: label risiko salah (`elevated`) untuk percakapan biasa; persona berbicara dengan mode hati-hati, dan metrik timeout L2 (target < 0,5%) pasti dilanggar.
- Dengan batas lebih tinggi: token pertama tertunda sebesar latensi L2 (persona ditahan sampai L2 selesai, aturan 2 AGENT.md). Satu giliran lokal ±4,2 dtk, sedikit di atas SLO p95 4 dtk.

## Yang sudah dicoba / diketahui

- Lokal sementara memakai `SAFETY_TIMEOUT_MS=6000` di `agent/.env`; semua cek smoke lulus.
- Router ±3–4,3 dtk; satu `/v1/turn` lengkap ±3–4,2 dtk.
- **Perbandingan model (15 Okt, proyek trial, pesan sintetis, L2 lewat `/v1/safety/classify`, 10 panggilan per model):**

  | Model | Median | p90 | Maks | Vonis sesuai harapan |
  |---|---|---|---|---|
  | `gemini-4-argon` (`LOW`) | 4,3 dtk | 5,2 dtk | 5,2 dtk | 10/10 |
  | `gemini-3.8-flash` (`LOW`) | 20 dtk | 27 dtk | 28,6 dtk | 10/10 |

  Flash tetap memakai 130–180 token *thinking* pada `LOW` (Argon: 0) dan latensinya sangat tidak stabil, 4–85 dtk, di `us` maupun `global`. Flash tidak menerima `MINIMAL` (400). Opsi B dengan `gemini-3.8-flash` **tidak membantu** saat ini.
- Persona sudah dijalankan paralel dengan L2 (`app/turn.py`): token pertama ≈ maks(L2, token pertama persona), bukan jumlah keduanya.
- Belum diukur dari Cloud Run `asia-southeast2` (jaraknya ke `us` mirip dengan dari laptop, tetapi tanpa jaringan rumah).

## Yang dibutuhkan untuk lepas

- [ ] Ukur ulang dari Cloud Run dev (p50/p95 L2 atas ≥ 50 pesan sintetis).
- [ ] Putuskan salah satu opsi di bawah, lalu set `SAFETY_TIMEOUT_MS` dev/prod dan perbarui 02 §12.2 bila SLO berubah.
- [ ] Jalankan `evals.safety` dengan pilihan akhir (recall crisis 100%).

## Opsi dan usulan

| Opsi | Konsekuensi |
|---|---|
| A. Naikkan `SAFETY_TIMEOUT_MS` ke ±6.000 | Tanpa perubahan kode; token pertama lebih lambat; SLO p95 perlu dilonggarkan |
| B. L2 memakai model yang lebih cepat (tier ketiga, mis. Gemini Flash di `us`) | Perubahan kecil di `agents/llm.py` dan config; L2 harus lulus `evals.safety` ulang; biaya lebih rendah |
| C. Argon untuk L2 dengan prompt/skema lebih ringkas | Perlu eksperimen; hasil belum pasti |

**Usulan default (diperbarui 15 Okt):** A — tetap Argon untuk L2 dengan `SAFETY_TIMEOUT_MS` ±6.000 (di atas p90 5,2 dtk), lalu ukur ulang dari Cloud Run. Uji ulang model Flash bila latensinya membaik atau ada model Flash-Lite di `us`.

## Riwayat

- 2026-10-15 — dibuka dari uji lokal Argon pertama.
- 2026-10-15 — `gemini-3.8-flash` diuji untuk L2: akurat tetapi jauh lebih lambat dan tidak stabil; usulan berubah ke opsi A.
- 2026-10-18 — dari [20261018-latensi-giliran-dan-refresh-chat](../tasks/20261018-latensi-giliran-dan-refresh-chat.md): perintah deploy Cloud Run belum pernah mengeset `SAFETY_TIMEOUT_MS`, jadi production masih memakai 3.000. Perintah `gcloud run services update agent … SAFETY_TIMEOUT_MS=6000` disiapkan di panduan setup §5.11 (menunggu persetujuan lead). Agent kini mencatat `l2_ms` dan `l2_timed_out` per giliran (log `turn timing`, metrik `agent_turn_l2_ms`), sehingga pengukuran ulang dari Cloud Run cukup membaca log/dashboard. Klien Gemini kini dipakai ulang lintas giliran (sebelumnya klien dan TLS baru per panggilan), yang juga memangkas latensi L2.

## Penyelesaian

—
