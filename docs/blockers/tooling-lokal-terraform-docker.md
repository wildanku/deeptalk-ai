# Tooling Lokal: Terraform, Docker, dan uv Belum Terpasang

**Status:** `OPEN`
**Dibuka:** 2026-10-08 · **Diselesaikan:** —
**Jenis:** akses
**Pemilik penyelesaian:** Wildan
**Memblokir:** verifikasi `infra/` (Terraform), build image `gateway/Dockerfile` dan `agent/Dockerfile`, `docker-compose.yml`, build image `deeptalk-web-v2/Dockerfile` (Dokploy)
**Muncul di task:** [20261008-skeleton-awal.md](../tasks/20261008-skeleton-awal.md)

## Masalah

Di mesin pengembangan, `terraform`, `docker`, dan `uv` tidak ada di `PATH`. Akibatnya kode Terraform dan kedua Dockerfile ditulis tanpa pernah dijalankan. `uv` sempat diakali dengan memasangnya di virtualenv sementara (bukan instalasi sistem) untuk membuat `uv.lock` dan menjalankan test agent.

## Dampak

- `terraform init/validate/plan` untuk `infra/envs/*` belum pernah dijalankan; `.terraform.lock.hcl` belum ada.
- `docker build` untuk gateway dan agent belum diverifikasi.
- `docker compose up` (Postgres :5433, Redis :6380) belum diverifikasi; smoke test gateway memakai Postgres/Redis Homebrew yang sudah berjalan.
- Perintah `uv` di `AGENT.md` belum bisa dijalankan langsung oleh engineer lain di mesin ini.

## Yang sudah dicoba / diketahui

- `brew` tersedia (`/opt/homebrew/bin/brew`). Tidak dipakai karena memasang tool global butuh persetujuan pemilik mesin.
- Gateway: lint, typecheck, unit, e2e, build, dan boot ke `/v1/health` sudah lulus tanpa Docker.
- Agent: ruff, mypy, pytest, dan boot ke `/health` sudah lulus memakai `uv` sementara.

## Yang dibutuhkan untuk lepas

- [ ] Pasang tool: `brew install uv terraform` (atau `hashicorp/tap/terraform`), serta Docker Desktop/OrbStack/Colima.
- [ ] `cd infra/envs/dev && terraform init -backend=false && terraform validate`, lalu commit `.terraform.lock.hcl`.
- [ ] `docker build gateway` dan `docker build agent` lulus, dan container menjawab health check.
- [ ] `docker compose up -d` lalu `pnpm exec prisma migrate dev` ke Postgres :5433.

## Opsi dan usulan

| Opsi | Konsekuensi |
|---|---|
| Pasang lokal via Homebrew | Cepat; semua verifikasi bisa dijalankan dari mesin ini |
| Verifikasi hanya di Cloud Build | Tidak perlu instalasi lokal, tetapi umpan balik lambat dan pipeline belum ada |

**Usulan default:** pasang lokal via Homebrew.

## Riwayat

- 2026-10-11 — task Phase 6 menambah modul `monitoring` yang belum bisa di-`terraform validate` tanpa Terraform lokal.

- 2026-10-08 — dibuka dari task skeleton awal.
- 2026-10-08 — task Phase 1: `uv` kembali dipakai dari virtualenv sementara; uji integrasi memakai Postgres dan Redis Homebrew (bukan `docker compose`). `cloudbuild/*.yaml` dan target Dockerfile `migrate` baru juga belum pernah di-build.
- 2026-10-14 — task Phase 8: metrik `instrument_response` dan grafik dashboard ditambahkan di `infra/modules/monitoring` tanpa `terraform fmt/validate` (Terraform tidak terpasang).
- 2026-10-15 — task topologi deployment: `deeptalk-web-v2/Dockerfile` baru (output `standalone`) belum pernah di-`docker build`. Yang sudah diverifikasi: `pnpm build` menghasilkan `.next/standalone`, dan server standalone yang dijalankan seperti tahap runner (`HOSTNAME=0.0.0.0`) melayani halaman, aset statis, dan `/teman-ai/bantuan`. Build pertama di Dokploy menjadi uji image-nya.

## Penyelesaian

—
