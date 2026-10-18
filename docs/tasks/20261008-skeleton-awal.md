# Skeleton Awal Repo deeptalk-ai

**Tanggal:** 2026-10-08
**Phase:** Phase 1 — Fondasi Platform ([03-phase.md](../03-phase.md))
**Komponen:** gateway, agent, content, infra, root
**Recap terkait:** [20261008-agent-instructions-dan-task-recap.md](20261008-agent-instructions-dan-task-recap.md)

## Tujuan

Membuat kerangka awal repo sesuai 02 §6.1, §7, §8, §11: code style, library, struktur service `gateway` dan `agent`, folder `content` dan `infra`, serta inisialisasi git dan `.gitignore`. Belum ada logika bisnis.

## Daftar Pekerjaan

- [x] `git init -b main` + `.gitignore`, `.gitattributes`, `.editorconfig`
- [x] README root
- [ ] `docker-compose.yml` lokal (Postgres :5433, Redis :6380) — terblokir: [tooling-lokal-terraform-docker](../blockers/tooling-lokal-terraform-docker.md) (ditulis, belum dijalankan)
- [x] gateway: tooling (package.json, tsconfig `strict`, eslint, prettier, nest-cli, jest)
- [x] gateway: bootstrap (`main.ts`, `app.module.ts`), env zod, envelope/filter/CORS dari v3
- [x] gateway: database (Prisma 7 + adapter-pg), skema inti Phase 1
- [x] gateway: Redis adapter Socket.IO, BullMQ, namespace `/ai` yang gagal tertutup
- [x] gateway: logger aman (redaksi isi pesan), health check
- [x] gateway: modul domain kosong sesuai 02 §6.1
- [x] gateway: `.env.example`
- [ ] gateway: `Dockerfile` — terblokir: [tooling-lokal-terraform-docker](../blockers/tooling-lokal-terraform-docker.md) (ditulis, belum di-build)
- [x] gateway: install, prisma generate, lint, typecheck, test, e2e, build, boot lulus
- [x] agent: tooling uv (pyproject, ruff, pytest, mypy strict), `.python-version`
- [x] agent: FastAPI app, config, logging JSON, skema kontrak, stub endpoint `/v1/*`
- [x] agent: paket `agents/`, `prompts/`, `evals/`
- [x] agent: `.env.example`
- [ ] agent: `Dockerfile` — terblokir: [tooling-lokal-terraform-docker](../blockers/tooling-lokal-terraform-docker.md) (ditulis, belum di-build)
- [x] agent: `uv.lock`, ruff, mypy, pytest, boot lulus
- [x] content: struktur folder dan README
- [ ] infra: kerangka Terraform `envs/{dev,staging,prod}` + `modules/project-services` — terblokir: [tooling-lokal-terraform-docker](../blockers/tooling-lokal-terraform-docker.md) (ditulis, belum `terraform validate`)
- [x] Perbarui `AGENT.md` (status, perintah, code style) dan skill `gateway`/`agent`
- [x] Perbarui status Phase 1 di `03-phase.md` (item ditambahkan saat task berjalan)

## File yang Diubah

- `.gitignore`, `.gitattributes`, `.editorconfig` — baru; ignore secrets/env, build artefact Node/Python/Terraform, `backend.hcl`, `*.tfvars`.
- `README.md`, `docker-compose.yml` — baru; peta repo dan dependensi lokal (port 5433/6380 agar tidak bentrok dengan v3).
- `gateway/package.json`, `pnpm-lock.yaml`, `tsconfig*.json`, `eslint.config.mjs`, `.prettierrc`, `nest-cli.json`, `prisma.config.ts` — tooling.
- `gateway/prisma/schema.prisma` — `ai_user_state`, `ai_sessions`, `ai_messages`, `ai_outbox`, `ai_inbound_events` (02 §8).
- `gateway/src/main.ts`, `app.module.ts` — bootstrap.
- `gateway/src/config/env.schema.ts` (+spec) — env 02 §11.1 + §6.3.
- `gateway/src/common/**`, `database/**`, `realtime/redis-io.adapter.ts` — disalin dari v3; filter error diubah agar hanya mencatat nama/kode error.
- `gateway/src/observability/logger.ts` (+spec) — pino dengan redaksi dan `severity`.
- `gateway/src/queue/queue.module.ts`, `realtime/ai.gateway.ts` (+spec), `realtime/realtime.module.ts`, `health/**` — infrastruktur runtime.
- `gateway/src/{auth,v3-client,agent-client,sessions,messages,safety,routines,assessments,handoffs,consents,lifecycle,content,evals}/*.module.ts` — modul kosong.
- `gateway/test/**` — e2e health + envelope.
- `gateway/Dockerfile`, `.dockerignore`, `.env.example`.
- `agent/pyproject.toml`, `uv.lock`, `.python-version` — tooling.
- `agent/app/{main,config,logging,schemas}.py`, `app/routes/v1.py` — aplikasi.
- `agent/agents/*.py`, `prompts/README.md`, `evals/README.md` — kerangka.
- `agent/tests/**` — health, stub, docs tertutup, formatter log, config.
- `agent/Dockerfile`, `.dockerignore`, `.env.example`.
- `content/**` — README + folder per jenis konten.
- `infra/**` — README, `modules/project-services`, `envs/{dev,staging,prod}`.
- `AGENT.md`, `.claude/skills/gateway/SKILL.md`, `.claude/skills/agent/SKILL.md` — status, perintah, code style, library, peta file.
- `docs/03-phase.md` — Phase 1 🟦, status item scaffold.
- `docs/blockers/tooling-lokal-terraform-docker.md`, `docs/blockers/README.md` — blocker baru.

## Keputusan

- TypeScript `strict: true` dan ESLint lebih ketat dari v3 (`no-explicit-any`, `no-floating-promises`, `no-console` = error); repo baru tanpa beban warisan.
- Logging: `nestjs-pino` (gateway) dan formatter JSON sendiri (agent), keduanya memakai `severity` Cloud Logging. Error tak terduga hanya dicatat nama/kodenya, karena pesan error Prisma bisa memuat nilai argumen.
- Env: string kosong dianggap tidak diset; variabel integrasi opsional di lokal dan wajib di `production`.
- `/ai` menolak semua koneksi sampai verifikasi token ada, supaya namespace tanpa auth tidak mungkin ter-deploy.
- Agent: `GET /health`, bukan `/healthz` (Cloud Run mereservasi sebagian path berakhiran `z`); docs OpenAPI dimatikan; endpoint `/v1/*` eksplisit `501`.
- Primary key UUIDv7 dibuat aplikasi; enum Prisma untuk level risiko, status sesi, dan outbox.
- Migrasi awal **belum** dibuat; dibuat saat database lokal/dev siap, agar skema masih bisa berubah tanpa migrasi sampah.
- `SAFETY_TIMEOUT_MS=3000` dan `MAX_OUTPUT_TOKENS=1024` adalah nilai sementara (02 tidak menetapkan angka); nama model tanpa default karena menunggu Q7.
- `httpx2` sebagai dev dependency agent (Starlette TestClient menandai `httpx` deprecated).
- Git di-init tanpa commit; commit pertama menunggu persetujuan pengguna.

## Validasi

- [x] `pnpm run lint:check`, `typecheck`, `build` (gateway) — lulus.
- [x] `pnpm run test` — 40 passed (7 suite); `pnpm run test:e2e` — 2 passed.
- [x] `pnpm exec prisma validate` + `prisma generate` — valid.
- [x] Boot gateway (`node dist/main`, Postgres/Redis Homebrew lokal, hanya `SELECT 1`) → `GET /v1/health` = `{"success":true,"data":{"status":"ok","database":"connected"}}`, log JSON dengan `severity`.
- [x] `.env.example` gateway dan agent lolos validasi env masing-masing.
- [x] `uv lock --check`, `ruff format --check`, `ruff check`, `mypy` (strict, 18 file), `pytest` (12 passed) — lulus.
- [x] Boot agent (`uvicorn`) → `GET /health` 200, `POST /v1/turn` 501, log uvicorn dalam JSON.
- [x] `git check-ignore`: `node_modules`, `.venv`, `src/generated` diabaikan; `.env.example` ter-track; tidak ada artefak build/secret di `git status`.
- [ ] `terraform validate` — terblokir: `terraform` tidak terpasang.
- [ ] `docker build` gateway/agent dan `docker compose up` — terblokir: `docker` tidak terpasang.

## Blocker

- [tooling-lokal-terraform-docker](../blockers/tooling-lokal-terraform-docker.md) — `terraform`, `docker`, dan `uv` belum terpasang, sehingga infra, Dockerfile, dan docker-compose belum diverifikasi.

## Follow-up

- [ ] Commit awal (`git add -A && git commit`) setelah pengguna meninjau.
- [ ] Migrasi awal Prisma ke database lokal (`prisma migrate dev`) setelah skema inti disepakati.
- [ ] Phase 1 `auth/`: verifikasi token via JWKS (`jose`) di REST, handshake socket, dan `auth.refresh`; lalu buka `/ai`.
- [ ] Phase 1 `messages/`: enkripsi isi pesan dengan KMS.
- [ ] Phase 1 agent: `POST /v1/turn` SSE dengan ADK dan aturan global.
- [ ] Tracing (OpenTelemetry → Cloud Trace) tanpa isi pesan.
- [ ] Pipeline Cloud Build (lint, test, migrate deploy, deploy bertahap).
- [ ] Modul Terraform berikutnya (network, Cloud SQL, Memorystore, KMS, Secret Manager, Artifact Registry, Cloud Run).

## Rekap Status

**Status:** ⛔ Terblokir
**Progres:** 18/22 item selesai

| Belum selesai | Alasan |
|---|---|
| `docker-compose.yml` | Terblokir: `docker` tidak terpasang (ditulis, belum dijalankan) |
| gateway `Dockerfile` | Terblokir: `docker` tidak terpasang (ditulis, belum di-build) |
| agent `Dockerfile` | Terblokir: `docker` tidak terpasang (ditulis, belum di-build) |
| Kerangka Terraform | Terblokir: `terraform` tidak terpasang (ditulis, belum divalidasi) |
