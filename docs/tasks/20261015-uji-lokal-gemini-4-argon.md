# Uji Lokal Gemini 4 Argon (Proyek Trial)

**Tanggal:** 2026-10-15
**Phase:** Phase 0 (verifikasi model, Q7), [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md)
**Komponen:** agent, docs

## Tujuan

Memastikan agent bisa memakai `gemini-4-argon` di region `us` dengan service account dari proyek trial `deeptalk-496008` (key di `deeptalk-ai/.creds/`), dan menyediakan uji prompt sederhana yang bisa diulang.

## Daftar Pekerjaan

- [x] `.creds/` dan `agent/.env` dipastikan diabaikan git; key dibatasi `chmod 600`. Isi key tidak dibaca selain `type`/`project_id`/`client_email`
- [x] `agent/.env` lokal: `MODEL_PROVIDER=vertex`, `us`, `gemini-4-argon` kedua tier, path key `agent-run`
- [x] `GOOGLE_APPLICATION_CREDENTIALS` dari `.env` diekspor ke proses (`export_vertex_env`); ditolak di production
- [x] Test tidak lagi membaca `agent/.env` developer (`tests/conftest.py`). Sebelumnya `.env` vertex membuat 4 test memanggil model sungguhan dan gagal
- [x] Skrip `evals/smoke_model.py`: satu prompt per tier, L2 (pesan biasa + kalimat krisis sintetis), router, satu `/v1/turn`; latensi, token, exit 1 bila gagal
- [x] Jalankan uji: semua lulus dengan `SAFETY_TIMEOUT_MS=6000`
- [x] Temuan latensi L2 dicatat sebagai blocker keputusan
- [x] Dokumen: `.env.example`, `evals/README.md`, AGENT.md, 02 §11.1, 03, panduan setup (§3 no. 6, checklist §2), blocker
- [ ] Uji lewat gateway (stack lokal + `smoke-chat.mjs`) dan draft Persona Card dari dashboard — belum dijalankan di task ini

## File yang Diubah

- `agent/app/config.py` — `GOOGLE_APPLICATION_CREDENTIALS` (opsional; ditolak di production)
- `agent/agents/llm.py` — `export_vertex_env` mengekspor path key
- `agent/tests/conftest.py` — `Settings` tanpa `.env` saat test
- `agent/tests/test_config.py` — 2 test baru (production menolak key; path dari `.env` sampai ke proses)
- `agent/evals/smoke_model.py` (baru), `agent/evals/README.md`, `agent/.env.example`
- `AGENT.md`, `docs/02-implementasi.md`, `docs/03-phase.md`
- `docs/blockers/latensi-l2-argon.md` (baru), `docs/blockers/README.md`, `docs/blockers/lingkungan-gcp-dev.md`
- `../docs/deeptalk-ai/setup-gcp-agent-platform-argon.md` (root logos-dev)
- Lokal, tidak di-commit: `agent/.env`

## Keputusan

- **File key hanya untuk lokal.** Production menolak `GOOGLE_APPLICATION_CREDENTIALS`, karena Cloud Run memakai service account yang dipasang (topologi 15 Okt).
- **Test terisolasi dari `.env`.** Developer boleh menyimpan `.env` vertex tanpa merusak test atau memanggil model berbayar.
- **`SAFETY_TIMEOUT_MS=6000` hanya di `.env` lokal.** Default kode tetap 3.000 sampai blocker [latensi-l2-argon](../blockers/latensi-l2-argon.md) diputuskan.

## Validasi

- agent: `ruff format`, `ruff check` bersih, `mypy` 33 file bersih, **pytest 43/43** dengan `agent/.env` vertex terpasang. `uv` tidak ada di PATH (blocker tooling), jadi tool dijalankan dari `.venv/bin`.
- Panggilan mentah: `gemini-4-argon` lewat `aiplatform.us.rep.googleapis.com` (endpoint regional `us`), 200 OK.
- `python -m evals.smoke_model`, semua OK:

| Cek | Hasil |
|---|---|
| Tier chat (thinking `LOW`) | 2,9–4,2 dtk; ±45 token input, ±35 output, thinking 0 |
| Tier dokumen (`MEDIUM`) | 2,2–2,5 dtk |
| L2 pesan biasa / krisis sintetis | `normal` / `crisis` (sinyal `suicidal_ideation`); 2,6–4,2 dtk |
| Router | memilih persona yang tepat; 3,1–4,3 dtk |
| `/v1/turn` | `safety → token → done`, L3 tidak mengganti, ±343 token input; 3,0–4,2 dtk |

- Dengan `SAFETY_TIMEOUT_MS=3000` (default): L2 timeout → `elevated` pada kedua pesan uji.

## Blocker

- [latensi-l2-argon](../blockers/latensi-l2-argon.md) — baru.
- [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md) — diperbarui (proyek trial, hasil uji).

## Follow-up

- Uji lewat gateway: stack E2E + agent Argon + `gateway/scripts/smoke-chat.mjs`; draft Persona Card dari dashboard lokal.
- `evals.safety` dengan Argon (gerbang recall crisis 100%) setelah set studi kasus ada.
- Ukur ulang latensi dari Cloud Run `asia-southeast2`.

## Rekap Status

- **Selesai:** 8/9
- **Belum:** uji lewat gateway dan draft Persona Card (langkah berikutnya, tidak terblokir)
- **Status task:** 🟨 Sebagian — agent dan Argon berjalan normal; L2 butuh keputusan batas waktu.
