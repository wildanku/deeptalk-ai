# Model Gemini 4 Argon di Region `us`

**Tanggal:** 2026-10-15
**Phase:** Phase 0/1 (Q7, model + endpoint), [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md)
**Komponen:** agent, docs, content (DRAFT consent)
**Panduan:** [setup-gcp-agent-platform-argon](../../../docs/deeptalk-ai/setup-gcp-agent-platform-argon.md)

## Tujuan

Keputusan Wildan (2026-10-15): semua layanan Gemini / Gemini Enterprise Agent Platform memakai region **`us`**, dengan model **`gemini-4-argon`**. Data yang disimpan (Cloud SQL, KMS, Redis, log, Cloud Run, Artifact Registry, Sensitive Data Protection) tetap di `asia-southeast2`.

Sesuaikan kode agent agar siap memanggil Argon (SDK, caching, *thinking*, lokasi), lalu perbarui semua dokumen dan klaim yang menyebut pemrosesan AI di Jakarta.

## Daftar Pekerjaan

### Agent
- [x] `GOOGLE_CLOUD_LOCATION` default `us`, hanya menerima `us`/`eu`/`global`, **wajib `us` di production**; `.env.example`, test config
- [x] `google-genai` 2.29.0 → 2.31.0 (minimum 2.30.1 di `pyproject.toml`); `google-adk` 2.11.0 tetap kompatibel; `uv.lock` diperbarui
- [x] Explicit context caching mati secara default (`CONTEXT_CACHE=off|explicit`); Argon hanya mendukung implicit caching
- [x] `thinking_level` per tier (`THINKING_CHAT=LOW`, `THINKING_DOCUMENT=MEDIUM`) lewat `Models.generate_config`, dipasang di persona, safety, router, kartu, ringkasan, handoff, dan draft persona; tidak dikirim ke model lokal
- [x] `MAX_OUTPUT_TOKENS` 1.024 → 2.048, karena token *thinking* ikut dihitung dalam batas output Gemini 4
- [x] `cloudbuild/promote.yaml`: gerbang evaluasi memakai `_MODEL_LOCATION=us`, terpisah dari `_REGION` (Cloud Run Jakarta). Sebelumnya gerbang ini akan gagal
- [x] ruff, mypy, pytest (41); E2E regresi (model lokal)
- [ ] Panggilan sungguhan ke `gemini-4-argon` di `us`, latensi L2, `evals.safety` — terblokir: [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md) (proyek GCP belum ada)

### Dokumen dan klaim
- [x] 01 §6 Q7 diputuskan; T11
- [x] 02: §1, tabel tujuan, diagram (subgraph `us`), A2, tier agent §7, L2, §7.3 (implicit caching; RAG → pgvector karena RAG Engine tidak didukung Argon), §9.1 lokasi, §11.1 env, §12.3 biaya, §13
- [x] 03 (Q7, caching, latensi L2, tier dokumen), AGENT.md aturan privasi + stack model sungguhan, README, `infra/README.md`, deskripsi variabel region Terraform
- [x] Teks consent layanan DRAFT versi 2: disimpan di Indonesia, diproses model Google di AS (`min_accepted_version` tetap 1); E2E disesuaikan (`SERVICE_V`)
- [x] DPIA engineering, playbook pemanfaatan data (fine-tuning mengikuti `us`; Argon tidak mendukung tuning), kebijakan toko, runbook gangguan, audit ekspansi
- [x] Blocker: Q7 di lingkungan-gcp-dev; teks hukum (transfer ke luar negeri, UU PDP Pasal 56)
- [x] Panduan setup: keputusan `us` dan §3 ditandai selesai
- [ ] Persetujuan hukum atas pemrosesan di AS (consent final, kebijakan privasi, DPIA) — terblokir: [teks-hukum-consent-privasi-dpia](../blockers/teks-hukum-consent-privasi-dpia.md)

## File yang Diubah

**agent**
- `pyproject.toml`, `uv.lock` — `google-genai>=2.30.1` (terkunci 2.31.0)
- `app/config.py` — lokasi `us`, `THINKING_*`, `CONTEXT_CACHE`, `MAX_OUTPUT_TOKENS` 2.048, validasi production
- `agents/llm.py` — `Models.generate_config(tier, max_output_tokens)`
- `agents/persona.py` (`build_persona_agent` menerima config), `agents/{safety,router,cards,summary,handoff,persona_draft,evaluation}.py`
- `app/turn.py` — explicit cache hanya bila `CONTEXT_CACHE=explicit`
- `tests/test_config.py`, `tests/test_llm_config.py` (baru), `.env.example`

**lainnya di deeptalk-ai**
- `cloudbuild/promote.yaml`
- `content/consents/service.json` (DRAFT v2)
- `e2e/phase4-5.mjs`
- `docs/01-…`, `docs/02-implementasi.md`, `docs/03-phase.md`
- `docs/runbooks/gangguan-vertex-ai.md`, `docs/rilis/kebijakan-toko-aplikasi.md`, `docs/rilis/ekspansi-asia-tenggara.md`
- `docs/data/dpia-phase-9-engineering.md`, `docs/data/pemanfaatan-data.md`
- `docs/blockers/lingkungan-gcp-dev.md`, `docs/blockers/teks-hukum-consent-privasi-dpia.md`
- `AGENT.md`, `README.md`, `infra/README.md`, `infra/envs/*/main.tf` (deskripsi saja)

**root logos-dev**: `docs/deeptalk-ai/setup-gcp-agent-platform-argon.md`

## Keputusan

- **Region `us` untuk semua layanan Gemini/Agent Platform** (Wildan, 15 Okt). `us` dipilih karena menjamin pemrosesan di satu yurisdiksi; `global` tidak menjamin. Infrastruktur dan data tersimpan tetap di Jakarta; Sensitive Data Protection (Phase 9) bukan layanan Gemini dan tetap di `asia-southeast2`.
- **Production dikunci ke `us`** di validasi env agent. Lokasi pemrosesan adalah komitmen di teks consent dan DPIA, jadi berpindah ke `global`/`eu` (misalnya saat gangguan) harus berupa keputusan baru, bukan perubahan env. Non-production boleh `eu`/`global` untuk uji.
- **Satu model untuk kedua tier** (`gemini-4-argon`), dibedakan lewat *thinking*: `LOW` untuk chat dan safety (latensi L2 di bawah `SAFETY_TIMEOUT_MS`), `MEDIUM` untuk dokumen. Model Flash untuk L2/router tetap opsi bila latensi atau biaya tidak sesuai.
- **Explicit caching dimatikan, tidak dihapus.** Bisa diaktifkan lagi (`CONTEXT_CACHE=explicit`) untuk model yang mendukungnya.
- **Teks consent DRAFT dinaikkan ke versi 2** tanpa menaikkan `min_accepted_version`: masih DRAFT, dan konsultan hukum yang menentukan apakah perubahan ini material (meminta persetujuan ulang).

## Validasi

- Agent: `ruff format`/`ruff check` bersih, `mypy` (33 file) bersih, `pytest` 41 lulus (termasuk 4 test baru: lokasi dibatasi, production wajib `us`, *thinking* per tier, model lokal tanpa *thinking*).
- E2E (model lokal, SDK baru): run penuh 208 PASS di 6 skenario. Setelah consent v2: phase2-3, phase4-5, phase9, limits, resilience, phase8 semuanya lulus.
- `content:seed` lokal: consent layanan v2 masuk sebagai DRAFT.
- Belum: panggilan sungguhan ke `gemini-4-argon` (proyek GCP belum ada); kompatibilitas ADK 2.11 dengan Argon pada panggilan nyata; latensi L2; `evals.safety`.

## Blocker

- [lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md) — proyek GCP untuk uji Argon (Q7 sudah diputuskan; Q2 formal masih terbuka).
- [teks-hukum-consent-privasi-dpia](../blockers/teks-hukum-consent-privasi-dpia.md) — transfer ke AS di consent, kebijakan privasi, DPIA.

## Follow-up

- Setelah proyek GCP aktif:
  - ikuti §2 dan §4 panduan setup;
  - ukur latensi L2 dan sesuaikan `SAFETY_TIMEOUT_MS`;
  - catat token *thinking* per giliran untuk biaya per sesi;
  - jalankan `evals.safety` dengan Argon.
- Bila SDK menolak `vertexai=True` untuk Argon, beralih ke parameter `enterprise=True` sesuai contoh Google. ADK 2.11 memakai env `GOOGLE_GENAI_USE_VERTEXAI`; cek saat uji nyata.

## Rekap Status

**🟨 Sebagian.** 14 dari 16 item selesai dan terverifikasi. Belum: panggilan nyata ke Argon (menunggu proyek GCP) dan persetujuan hukum atas pemrosesan di AS.
