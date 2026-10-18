# evals/

Konfigurasi evaluasi ADK (02 §12.1).

- **Evaluasi safety:** seluruh studi kasus `crisis`. Gerbang rilis: recall L1+L2 = 100%; regresi memblokir promosi ke `prod`.
- **Evaluasi persona:** studi kasus `eval` per persona; setiap versi Persona Card baru butuh run yang dinilai psikolog sebelum `approved`.

- **Smoke test model:** `uv run python -m evals.smoke_model` (atau `--model` untuk panggilan model saja). Memakai `agent/.env` dengan `MODEL_PROVIDER=vertex`: satu prompt per tier, L2 (pesan biasa dan kalimat krisis sintetis), router, dan satu `/v1/turn` lengkap. Mencetak balasan, latensi, dan token; exit 1 bila ada yang gagal, termasuk L2 yang melewati `SAFETY_TIMEOUT_MS`. Bukan pengganti `evals.safety`.

Studi kasus disusun psikolog dan disimpan di `ai_eval_cases` (gateway). Jangan menyimpan percakapan pengguna nyata di repo; gunakan skenario sintetis.
