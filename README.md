# deeptalk-ai

DeepTalk AI ("Teman AI"): teman bicara berbasis AI dengan pendekatan yang dirancang psikolog DeepTalk. Dokumentasi lengkap di [docs/](docs/README.md); instruksi untuk AI agent di [AGENT.md](AGENT.md).

| Folder | Isi | Stack |
|---|---|---|
| [gateway/](gateway/) | Socket.IO `/ai`, REST `/v1`, sesi, kuota, safety L1, penyimpanan percakapan | NestJS 11, Prisma 7, Cloud Tasks, pnpm |
| [agent/](agent/) | Router, persona, safety L2/L3, routine, handoff, ringkasan | Python 3.12, Google ADK, FastAPI, uv |
| [content/](content/) | Seed awal konten klinis (bootstrap saja) | — |
| [infra/](infra/) | Google Cloud `asia-southeast2` (model Gemini di `us`) | Terraform |
| [e2e/](e2e/) | Skenario E2E lokal Phase 1–3 tanpa GCP | `./run.sh` |
| [docs/](docs/) | Desain, phase, recap task, blocker | — |

## Menjalankan lokal

Prasyarat: Node.js ≥ 24 + pnpm, Python 3.12 + [uv](https://docs.astral.sh/uv/), Postgres dan Redis (pakai `docker compose up -d`, atau instance lokal sendiri).

```bash
# Postgres :5433 dan Redis :6380
docker compose up -d

# gateway → http://localhost:8080/v1/health
cd gateway
cp .env.example .env   # isi MESSAGE_LOCAL_KEY (openssl rand -base64 32), AI_JWKS_URL, AGENT_URL
pnpm install
pnpm exec prisma migrate dev   # hanya ke database lokal
pnpm run start:dev

# agent → http://localhost:8000/health
cd agent
cp .env.example .env
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

Token AI diterbitkan `deeptalk-api-v3` (`POST /v2/user/ai/access`, panduan di `docs/guidance/ai-token-exchange.md` repo v3). Uji satu giliran lintas dua instance: `node gateway/scripts/smoke-chat.mjs` (lihat komentar di file).

Status: Phase 1–3 selesai di level kode dan teruji lokal (konten klinis masih `DRAFT`); deploy `dev` menunggu Phase 0, konten final menunggu psikolog. Lihat [docs/03-phase.md](docs/03-phase.md) dan [docs/blockers/](docs/blockers/README.md).
