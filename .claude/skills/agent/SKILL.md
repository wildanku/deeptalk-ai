---
name: agent
description: Konvensi Python + Google ADK untuk deeptalk-ai/agent — FastAPI endpoint internal /v1/*, SSE /v1/turn, safety L2/L3 dan safety gate, penyusunan prompt persona, output terstruktur, pemilihan model Gemini, dan evaluasi ADK. Muat untuk pekerjaan apa pun di agent/ (scaffold, agen, prompt, endpoint, eval, test) atau saat menjalankan lint/test agent.
metadata:
  type: project
---

# Agent (deeptalk-ai)

Logika AI: router, persona, safety, routine, handoff, ringkasan. Layanan Cloud Run **privat**, hanya dipanggil gateway. Acuan lengkap: `docs/02-implementasi.md` §7 dan §12.

> Phase 1 (2026-10-08): `POST /v1/turn` SSE berjalan dengan agen `persona` + aturan global `global-v0-draft` (**DRAFT**, belum ditinjau psikolog). Endpoint `/v1/*` lain masih `501`. Belum ada safety gate (Phase 2).
>
> Phase 2–3 (2026-10-10): `/v1/turn` dengan L2 paralel + safety gate + L3 streaming + kartu; `/v1/router/select`, `/v1/safety/classify`, `/v1/session/summary`, `/v1/handoff/draft`. `/v1/persona/draft` dan `/v1/eval/run` masih `501` (Phase 5). Semua prompt di `prompts/` masih **DRAFT**.
>
> Phase 5 (2026-10-11): `/v1/persona/draft` (`agents/persona_draft.py`, tier Pro, kartu tanpa `few_shots`) dan `/v1/eval/run` (`agents/evaluation.py`, L2 + L3 seperti giliran sungguhan) selesai.

## Stack dan library

| Kebutuhan | Library |
|---|---|
| Orkestrasi agen + eval | `google-adk` (lewat Vertex AI: `GOOGLE_GENAI_USE_VERTEXAI=true`) |
| HTTP | `fastapi` + `uvicorn[standard]` |
| SSE `/v1/turn` | `sse-starlette` |
| Konfigurasi | `pydantic-settings` |
| Dev | `pytest`, `httpx2` (TestClient), `ruff`, `mypy` |

Dependensi dikelola **uv** (`uv add`, `uv add --dev`); `uv.lock` di-commit. Proyek bertipe aplikasi (`package = false`), jalankan semuanya lewat `uv run`.

## Peta file

| Path | Isi |
|---|---|
| `app/main.py` | `create_app()`, `GET /health` (bukan `/healthz`: Cloud Run mereservasi sebagian path berakhiran `z`), tanpa docs publik |
| `app/config.py` | Env 02 §11.1; string kosong = tidak diset; `GOOGLE_CLOUD_PROJECT`, `MODEL_CHAT`, `MODEL_DOCUMENT` wajib di `production` |
| `app/logging.py` | JSON `severity` untuk Cloud Logging, termasuk log uvicorn; exception hanya nama tipenya |
| `app/schemas.py` | `RiskLevel`, `TurnEvent`, `SafetyVerdict`, `DoneEvent` |
| `app/contract.py` | Kontrak request/response dengan gateway: `TurnRequest` (persona, knowledge, memory, state, catalog), router, classify, summary, handoff draft, kartu |
| `app/routes/v1.py` | Endpoint internal 02 §7.1; `/v1/turn` → `EventSourceResponse` |
| `app/turn.py` | `TurnRunner`: persona ke antrean + L2 paralel → event `safety` → `crisis` membatalkan persona → `L3Stream` melepas token → `done` → kartu (`structured`, `exclude_none`, dibatasi `CARDS_TIMEOUT_MS`). Token pertama terlambat → diulang sekali; `PERSONA_TIMEOUT_MS` → `MODEL_TIMEOUT`; satu log `turn timing` per giliran |
| `agents/llm.py` | Satu `Gemini` bersama per tier (klien/koneksi dipakai ulang) dengan `MODEL_HTTP_TIMEOUT_MS` + retry `MODEL_RETRY_ATTEMPTS`; `warm_up()` saat startup |
| `agents/llm.py`, `agents/run.py` | Tier model (`chat`/`document`, stand-in lokal) dan helper `stream_events`/`run_text`/`run_structured` |
| `agents/persona.py` | `build_instruction` (callable, menghindari templating `{}`): global → card → pengetahuan → memori → state; context caching lewat `App(context_cache_config)` di Vertex |
| `agents/safety.py` | `SafetyClassifier` (L2, timeout → `elevated`), `L3_PATTERNS`, `L3Stream`, `L3_TEMPLATE` |
| `agents/router.py`, `summary.py`, `handoff.py`, `cards.py` | Router Quick Chat, ringkasan sesi, draft handoff (tier Pro), usulan kartu hanya dari katalog request |
| `agents/local_llm.py` | `LocalEchoLlm`/`LocalJsonLlm` untuk `MODEL_PROVIDER=local` (dev/test; ditolak di production); `LOCAL_MODEL_TOKEN_DELAY_MS`, `LOCAL_SAFETY_DELAY_MS`; probe `[uji-l3]` |
| `prompts/` | Prompt berversi per jenis (`global`, `safety`, `router`, `summary`, `handoff`, `cards`, `state`), semua `v0-draft`; `ACTIVE` memilih versi |
| `agents/persona_draft.py`, `agents/evaluation.py` | Draft Persona Card dari kuesioner (+ contoh gaya sebagai bukti gaya); evaluasi studi kasus sintetis per versi persona |
| `app/tracing.py` | `traceparent` dari gateway → field trace Cloud Logging di setiap log. **Jangan pernah mengonfigurasi exporter span**: span ADK memuat prompt dan output model |
| `evals/safety.py` | Gerbang L1+L2 (`python -m evals.safety <cases> <l1-results>`), exit 1 bila recall `crisis` < 100% |

Catatan: instruksi ADK mendukung templating `{nama}` dari state sesi — hindari kurung kurawal literal di prompt. Impor ADK mengikuti path dokumentasi (`google.adk.agents.run_config.StreamingMode`, `google.adk.models.llm_request`); mypy diberi `implicit_reexport` khusus `google.adk.*`.

## Perintah

| Tujuan | Perintah (di `agent/`) |
|---|---|
| Install | `uv sync` |
| Dev server (`:8000`) | `uv run uvicorn app.main:app --reload --port 8000` |
| Format | `uv run ruff format .` |
| Lint | `uv run ruff check .` |
| Typecheck | `uv run mypy app agents tests` |
| Test | `uv run pytest` |
| Gerbang safety | `uv run python -m evals.safety <cases.json> <l1-results.json>` (L1 dari `pnpm run eval:l1` di gateway) |

Jalankan `ruff format`, `ruff check`, `mypy`, dan `pytest` sebelum menganggap perubahan selesai, lalu catat hasilnya di recap (skill **task-recap**).

## Struktur (02 §11)

`app/` (FastAPI `/v1/*`) · `agents/` (router, persona, safety, routine, handoff, summary, persona_draft) · `prompts/` (aturan global berversi) · `evals/`.

## Aturan

### Batas layanan
- Agent **tidak pernah** memanggil v3 atau database, dan tidak memegang state durable. Semua konteks (riwayat, Persona Card, pengetahuan, memori, state sesi) dikirim gateway per request. ADK `Runner` memakai session service in-memory per request.
- Hanya bisa dipanggil service account gateway (IAM invoker, ingress internal).

### Endpoint (02 §7.1)
`POST /v1/turn` (SSE: `safety`, `token`, `done`, lalu `structured`, atau `error`), `/v1/router/select`, `/v1/safety/classify` (L2 saja, jalur kuota habis), `/v1/session/summary`, `/v1/handoff/draft`, `/v1/persona/draft`, `/v1/eval/run`. Event `done` selalu membawa nama model dan versi prompt.

### Safety
- **L2**: klasifikasi Gemini Flash, structured output `{ level, signals[], rationale }`, dijalankan paralel dengan generate persona. Timeout `SAFETY_TIMEOUT_MS` atau error → `elevated` dan dicatat.
- **Safety gate**: token persona ditahan sampai vonis L2. Bila `crisis`, respons persona dibatalkan — tidak ada token yang sempat keluar.
- **L3**: setelah generate, cek nama obat, dosis, dan bahasa diagnosis + safety filter Vertex; bila gagal, ganti dengan template aman dan catat.
- Teks protokol krisis berasal dari konten berversi psikolog, bukan dihasilkan LLM.

### Prompt (02 §7.3)
Urutan instruksi sistem: aturan global → Persona Card `approved` → pengetahuan klinis per topik → memori lintas sesi → state sesi (`wrap_up`, level risiko, kartu yang sudah ditawarkan). Few-shot dan studi kasus evaluasi tidak boleh tercampur (`usage`). Aturan global berversi di `prompts/`; jangan menulis konten klinis sendiri — placeholder harus bertanda `DRAFT`.

### Model dan biaya
Tier Flash untuk percakapan, router, safety, ringkasan; tier Pro hanya untuk dokumen (handoff, draft persona). Nama model dari env (`MODEL_CHAT`, `MODEL_DOCUMENT`), patuhi `MAX_OUTPUT_TOKENS`.

### Output terstruktur
Agent mengusulkan kartu (routine, asesmen, handoff — skema di 02 §7.4); gateway yang memvalidasi. Jangan menawarkan routine atau consent bila level sesi bukan `normal`.

### Privasi
Tidak ada isi pesan di log, trace, atau error. Gunakan contoh sintetis di test dan eval.

### Test dan evaluasi wajib (02 §12.1)
Unit: structured output, buffer safety gate, timeout L2 → `elevated`. Evaluasi safety pada seluruh studi kasus `crisis`: recall L1+L2 = 100% adalah gerbang rilis. Setiap versi Persona Card baru butuh eval run yang dinilai psikolog sebelum `approved`.
