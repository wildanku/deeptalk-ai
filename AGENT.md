# deeptalk-ai

Layanan **DeepTalk AI ("Teman AI")**: teman bicara berbasis AI dengan pendekatan yang dirancang psikolog DeepTalk. Diperlakukan sebagai produk produksi (bukan prototipe kompetisi).

> **Status repo (2026-10-08):** Phase 1 selesai di level kode dan teruji lokal ([recap](docs/tasks/20261008-phase-1-fondasi-platform.md)): token AI via JWKS, `/ai` multi-instance, `message.send` → agent → streaming, enkripsi pesan, riwayat untuk reconnect. Penyelesaian di `dev` menunggu Phase 0 (GCP) — lihat [docs/blockers/](docs/blockers/README.md). **Phase 2–3 (2026-10-10):** persona, safety L1/L2/L3 + safety gate, kuota dan waktu aktif, memori, routine, asesmen, dan handoff selesai di level kode dan teruji lokal ([recap](docs/tasks/20261010-phase-2-3-percakapan-keamanan-output.md)). **Semua konten klinis (`content/`, `agent/prompts/`) masih `DRAFT`** dan tidak aktif di production sampai disetujui psikolog ([blocker](docs/blockers/konten-klinis-gelombang-pertama.md)). **Phase 4–5 (2026-10-11):** consent berversi + gerbang usia, hapus/merge akun (feed `deleted_data` v3 + webhook), hapus riwayat, job retensi, portal psikolog (persona, evaluasi, ringkasan handoff, kurasi konten, tinjauan keamanan) di dashboard, push handoff di psikolog-app ([recap](docs/tasks/20261010-phase-4-5-consent-data-portal-psikolog.md)). Teks consent masih `DRAFT` dan menunggu hukum. **Phase 6 (2026-10-11):** metrik SLO + tracing tanpa isi, modul `infra/modules/monitoring`, runbook ([docs/runbooks/](docs/runbooks/README.md)), uji beban (`e2e/run.sh load`), tinjauan keamanan internal, gerbang persona di pipeline, "Laporkan respons AI" ([recap](docs/tasks/20261011-phase-6-hardening-produksi.md)). **Phase 7 (2026-10-14):** pintu masuk beranda, indikator dampak (`/v1/review/impact`, dashboard Dampak), `rollout:readiness`, playbook dan materi komunikasi ([docs/rilis/](docs/rilis/peluncuran-bertahap.md)); peluncuran menunggu blocker. **Phase 8 (2026-10-14):** router untuk banyak persona, kind `topic` + Cakupan, cek diri (check-in, skrining, inventori; `src/instruments/`) di web/app, `knowledge:budget`, audit ekspansi ([recap](docs/tasks/20261014-phase-8-pengembangan-lanjutan.md)); instrumen dan topik masih `DRAFT`. **Phase 9 (2026-10-14):** consent `legacy_counseling`, addendum psikolog, register gerbang persetujuan (`data:gate`), pipeline dataset terkunci (`dataset`: de-identifikasi SDP → tinjauan `data_reviewer` → ekspor bertahap), DPIA bagian engineering ([docs/data/](docs/data/pemanfaatan-data.md)); **tidak ada data asli yang disentuh** sampai gerbang dibuka manusia. **Topologi deployment (2026-10-15):** gateway + agent di Cloud Run; Postgres AI (service terpisah), Redis, web, v3, dan psikolog-service di VM GCE + Dokploy; antrian gateway pindah dari BullMQ ke **Cloud Tasks** (`src/tasks/`, driver `local` berbasis Postgres untuk dev/E2E) ([recap](docs/tasks/20261015-topologi-deployment-cloud-tasks.md), [topologi](../docs/deeptalk-ai/topologi-deployment-151026.md)).

## Baca dulu

| Dokumen | Kapan dibaca |
|---|---|
| [docs/README.md](docs/README.md) | Peta dokumentasi dan repo terkait |
| [docs/01-review-dokumen-dan-codebase.md](docs/01-review-dokumen-dan-codebase.md) | Sebelum mengubah keputusan produk/arsitektur; §6 berisi keputusan terbuka Q1–Q12 |
| [docs/02-implementasi.md](docs/02-implementasi.md) | Sebelum menulis kode: arsitektur, kontrak v3, gateway, agent, model data, keamanan |
| [docs/03-phase.md](docs/03-phase.md) | Sebelum memulai task: phase aktif, checklist, exit criteria |
| `docs/tasks/` (3–5 recap terbaru di area yang sama) | Sebelum mengubah area yang sudah pernah dikerjakan |
| [docs/blockers/README.md](docs/blockers/README.md) | Sebelum memulai task: pastikan tidak sedang terblokir |

Bila 02 dan 03 bertentangan, 02 yang menjadi acuan teknis dan 03 yang diperbaiki.

## Struktur (02 §11)

```
deeptalk-ai/
├── gateway/   # NestJS 11 + Prisma, pnpm — Socket.IO /ai, REST /v1, sesi, kuota, consent, handoff
├── agent/     # Python 3.12 + ADK + FastAPI, uv — router, persona, safety, routine, handoff, summary
├── content/   # seed awal konten klinis (bootstrap saja; setelah itu DB jadi sumber kebenaran)
├── infra/     # Terraform: Cloud Run, Cloud Tasks, Scheduler, Secret Manager, KMS, IAM (Postgres/Redis di VM Dokploy)
├── cloudbuild/# pipeline Cloud Build (gateway, agent, promote + gerbang evaluasi safety)
├── e2e/       # skenario E2E lokal Phase 1–3 (v3 tiruan, agent lokal, dua gateway)
└── docs/      # dokumentasi, recap task, register blocker
```

## Aturan yang tidak boleh dilanggar

1. **Arah panggilan** (02 §3): client tidak pernah memanggil `agent`. `agent` tidak pernah memanggil v3 atau database; semua tool yang butuh data dijalankan gateway. v3 memanggil gateway hanya untuk webhook siklus hidup akun.
2. **Keamanan adalah gerbang.** Safety berlapis (L1 gateway, L2/L3 agent) tidak boleh bisa dilewati persona, kuota, atau kegagalan model. Gagal harus tertutup: timeout L2 → `elevated`; agent/Vertex mati → L1 tetap jalan dan pesan krisis tetap menerima protokol. Token persona ditahan sampai L2 selesai.
3. **Konten klinis hanya dari psikolog.** Persona, protokol krisis, frasa L1, pustaka routine, pemetaan asesmen: berversi dan aktif hanya bila `approved`. Engineering boleh memakai placeholder bertanda `DRAFT`; jangan pernah menulis teks klinis sendiri lalu menganggapnya final.
4. **Privasi (UU PDP).** Data percakapan atau konseling tidak pernah dipakai untuk evaluasi/pelatihan sebelum gerbang Phase 9 dibuka oleh pemiliknya (DPIA, etik); engineering tidak pernah membuka gerbang atas inisiatif sendiri dan tidak pernah membaca store `chat-service`. Isi percakapan tidak boleh muncul di log, trace, metrik, pesan error, alert, maupun recap. Isi pesan disimpan terenkripsi (KMS). Data disimpan di `asia-southeast2`; model Gemini diproses di region `us` (keputusan Q7, 02 §9.1). Agent menolak lokasi model selain `us` di production, dan klaim lokasi di materi apa pun harus membedakan penyimpanan (Indonesia) dari pemrosesan model (AS).
5. **Rahasia.** Jangan menulis kunci, token, DSN berkredensial, atau isi `.env` ke kode, dokumen, recap, atau blocker.
6. **Tidak mengganggu `deeptalk-api-v3`.** Perubahan di v3 hanya berupa endpoint tambahan, tanpa migrasi skema.

## Perintah

```bash
docker compose up -d                 # Postgres :5433 + Redis :6380 untuk lokal

# gateway/ (pnpm saja, jangan npm/yarn)
pnpm install                         # juga menjalankan prisma generate
pnpm run start:dev                   # http://localhost:8080/v1/health
pnpm run lint                        # eslint --fix (lint:check tanpa fix)
pnpm run typecheck
pnpm run test
pnpm run test:e2e
pnpm run build
pnpm exec prisma validate
pnpm exec prisma migrate dev         # HANYA database lokal
pnpm exec prisma migrate deploy      # dev/staging/prod: hanya lewat pipeline
pnpm run content:seed                # seed content/ ke ai_content_versions/ai_personas (append-only)
pnpm run eval:l1 <cases.json> <l1-results.json>   # vonis L1 per studi kasus → input gerbang di agent
pnpm run roles:grant <psikolog_id> clinical_reviewer --by <siapa> [--revoke]   # peran reviewer klinis
pnpm run eval:personas               # gerbang rilis: setiap persona aktif punya evaluasi lengkap yang semuanya aman
pnpm run rollout:readiness -- --stage internal|beta|percentage|ga   # syarat naik tahap peluncuran
pnpm run knowledge:budget            # ambang materi prompt → RAG (02 §7.3); exit 1 bila terlewati
pnpm run data:gate -- status         # gerbang pemanfaatan data (Phase 9); membuka gerbang HANYA atas instruksi tertulis pemiliknya
pnpm run dataset -- status|collect|import-legacy <f>|export --purpose … --out … --by …   # menolak tanpa gerbang

# agent/ (uv)
uv sync
uv run uvicorn app.main:app --reload --port 8000   # http://localhost:8000/health
uv run ruff format .
uv run ruff check .
uv run mypy app agents tests
uv run pytest
uv run python -m evals.safety <cases.json> <l1-results.json>   # gerbang L1+L2: recall crisis harus 100% (exit 1)
uv run python -m evals.smoke_model  # uji model sungguhan (agent/.env MODEL_PROVIDER=vertex): tier, L2, router, satu giliran

# infra/envs/<env>/
terraform init -backend-config=backend.hcl
terraform plan

# Stack lokal Teman AI satu perintah: agent :8000, v3 cabang AI :3100 (build di .dev/v3-ai), gateway :8080,
# web :3000, dashboard :3001. Butuh Postgres + Redis lokal dan .env di kelima repo
./scripts/dev-stack.sh up|down|restart|status|logs [agent|v3|gateway|web|dashboard]

# Smoke test satu giliran lintas dua instance (lokal atau dev)
GATEWAY_A=… GATEWAY_B=… AI_TOKEN=<dari POST /v2/user/ai/access> node gateway/scripts/smoke-chat.mjs

# E2E lokal Phase 2–9 (v3 tiruan, agent lokal, dua gateway) — lihat e2e/README.md
V3_DIR=../deeptalk-api-v3 E2E_DATABASE_URL=… ./e2e/run.sh
# Uji beban lokal (indikator SLO dari sisi client); di macOS pakai caffeinate agar host tidak tidur
LOAD_USERS=100 TURNS=5 caffeinate -i ./e2e/run.sh load
```

**Stack lokal tanpa GCP:** gateway dengan `MESSAGE_LOCAL_KEY` (bukan KMS), `AGENT_AUTH=none`, dan `AI_JWKS_URL` ke v3 lokal; agent dengan `MODEL_PROVIDER=local` (model echo deterministik; `LOCAL_MODEL_TOKEN_DELAY_MS` untuk mensimulasikan giliran lambat). Ketiganya ditolak env validation di production. Model sungguhan: `MODEL_PROVIDER=vertex`, `GOOGLE_CLOUD_LOCATION=us`, `MODEL_CHAT`/`MODEL_DOCUMENT=gemini-4-argon` ([panduan setup](../docs/deeptalk-ai/setup-gcp-agent-platform-argon.md)). Kredensial lokal: ADC, atau `GOOGLE_APPLICATION_CREDENTIALS` di `agent/.env` yang menunjuk key di `.creds/` (diabaikan git; ditolak di production). Cek dengan `uv run python -m evals.smoke_model`.

Sebelum menganggap perubahan selesai: gateway → `lint`, `typecheck`, `test`, `test:e2e`, `build`; agent → `ruff format`, `ruff check`, `mypy`, `pytest`. Evaluasi safety (recall L1+L2 = 100% pada set `crisis`) adalah gerbang rilis; regresi memblokir promosi ke `prod`.

## Code style

Ditegakkan tooling; jangan memformat manual.

| | gateway (TypeScript) | agent (Python) |
|---|---|---|
| Format | Prettier: single quote, trailing comma | `ruff format`, baris 100 |
| Lint | ESLint flat config + `typescript-eslint` type-checked; `no-explicit-any`, `no-floating-promises`, `no-console` = error | ruff: `E W F I B UP SIM N RUF ASYNC S T20` |
| Tipe | `strict: true` | `mypy --strict` + plugin pydantic |
| Test | Jest, `*.spec.ts` di samping file; e2e di `test/*.e2e-spec.ts` | pytest di `tests/` |
| Logging | `nestjs-pino` (JSON, `severity`, redaksi konten) — jangan `console.*` | `app/logging.py` (JSON) — jangan `print` |
| Konfigurasi | zod di `src/config/env.schema.ts` | pydantic-settings di `app/config.py` |

- Bahasa: kode, komentar, dan nama dalam bahasa Inggris (seperti v3); dokumen di `docs/` dalam bahasa Indonesia.
- Komentar menjelaskan **kenapa**, bukan apa. Rujuk bagian dokumen (mis. `02 §6.3`) bila aturan berasal dari desain.
- Env baru: tambahkan ke skema, `.env.example`, dan tabel 02 §11.1. Variabel integrasi boleh opsional di lokal tetapi wajib di `production` (gagal tertutup).
- Error tak terduga hanya dicatat nama/kodenya — pesan error bisa memuat isi percakapan.

## Perubahan di repo lain

Ikuti konvensi repo tujuan, dan catat recap di repo tersebut **dan** rujuk dari recap di repo ini:

| Repo | Konvensi |
|---|---|
| `deeptalk-api-v3` | `AGENT.md`, recap `docs/tasks/`, `openapi.yaml`, jangan pernah `prisma migrate dev` |
| `deeptalk-web-v2` | `AGENTS.md`, `docs/phase/DEFINITION-OF-DONE.md` |
| `deeptalk-app-v2`, `psikolog-app-v2`, `psikolog-deeptalk-dashboard` | `AGENTS.md` |

Fitur pengguna dianggap selesai bila tersedia di web **dan** app, kecuali disebut lain.

## Dokumentasi Task dan Blocker (Wajib)

Setiap task yang mengubah kode, konfigurasi, dependensi, skema, infrastruktur, atau dokumen di repo ini **wajib** didokumentasikan. Ikuti skill **task-recap** ([.claude/skills/task-recap/SKILL.md](.claude/skills/task-recap/SKILL.md)) untuk template lengkap. Ringkasnya:

1. **Awal task — daftar pekerjaan.** Pecah task menjadi daftar item konkret, lalu langsung buat `docs/tasks/YYYYMMDD-<nama-task>.md` berisi daftar itu (semua `[ ]`). File dibuat di awal supaya catatan tetap ada walau sesi terputus.
2. **Selama task — perbarui.** Centang item yang selesai, tambahkan item baru yang muncul, catat file yang diubah.
3. **Akhir task — tandai status.** Tandai setiap item: `[x]` hanya untuk yang benar-benar selesai **dan** terverifikasi; `[ ]` untuk yang belum, dengan alasan singkat. Tulis bagian **Rekap Status** di akhir file: jumlah selesai/total, daftar yang belum, dan status task (✅ Selesai · 🟨 Sebagian · ⛔ Terblokir).
4. **Blocker — tulis terpisah.** Setiap hal yang menghalangi item selesai dan butuh pihak/keputusan/akses dari luar ditulis di `docs/blockers/<nama-blocker>.md`, didaftarkan di [docs/blockers/README.md](docs/blockers/README.md), dan ditautkan dari recap task. Blocker yang sudah ada diperbarui, bukan diduplikasi.
5. **Phase.** Bila item di [docs/03-phase.md](docs/03-phase.md) berpindah status, perbarui checkbox dan legenda phase-nya.

Task belum boleh diserahkan kembali ke pengguna sebelum recap ditulis dan checklist-nya mencerminkan status sebenarnya.

## Skills

- **task-recap** ([.claude/skills/task-recap/SKILL.md](.claude/skills/task-recap/SKILL.md)) — alur dan template dokumentasi task (`docs/tasks/`) dan blocker (`docs/blockers/`). Muat di awal **setiap** task yang mengubah repo ini.
- **gateway** ([.claude/skills/gateway/SKILL.md](.claude/skills/gateway/SKILL.md)) — konvensi NestJS untuk `gateway/`: modul, Socket.IO `/ai`, auth JWKS, Prisma, sesi/kuota, safety L1. Muat untuk pekerjaan di `gateway/`.
- **agent** ([.claude/skills/agent/SKILL.md](.claude/skills/agent/SKILL.md)) — konvensi Python + ADK untuk `agent/`: endpoint `/v1/*`, SSE, safety L2/L3, output terstruktur, evaluasi. Muat untuk pekerjaan di `agent/`.
