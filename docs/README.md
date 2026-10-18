# DeepTalk AI — Dokumentasi

Dokumentasi implementasi DeepTalk AI ("Teman AI"): teman bicara berbasis AI dengan pendekatan yang dirancang psikolog DeepTalk. Dokumen ini memperlakukan DeepTalk AI sebagai produk produksi, tanpa konteks kompetisi dan tanpa timeline.

| Dokumen | Isi | Untuk siapa |
|---|---|---|
| [01-review-dokumen-dan-codebase.md](01-review-dokumen-dan-codebase.md) | Perubahan konteks, temuan dari review dokumen sumber dan codebase, perubahan dari rancangan awal, keputusan yang masih terbuka | Wildan, Pak Novri |
| [02-implementasi.md](02-implementasi.md) | Arsitektur, kontrak integrasi dengan `deeptalk-api-v3`, gateway, agent, model data, keamanan dan privasi, client, deployment, operasional | Engineer |
| [03-phase.md](03-phase.md) | Cakupan rilis pertama, jalur konten psikolog, checklist dan exit criteria Phase 0–9 | Seluruh tim |
| [data/](data/pemanfaatan-data.md) | Pemanfaatan data percakapan (Phase 9): urutan gerbang, playbook, DPIA bagian engineering | Wildan, Pak Novri, hukum, peninjau etik |

## Dokumen sumber

- [`docs/deeptalk-ai/DeepTalk_AI_Konsep_dan_Eksekusi.md`](../../docs/deeptalk-ai/DeepTalk_AI_Konsep_dan_Eksekusi.md): §1–§8 (produk, keamanan, etika, consent, data) tetap menjadi acuan produk. Bagian kompetisi dan jadwal tidak berlaku (lihat 01 §0)
- [`docs/deeptalk-ai/DeepTalk_AI_Rekomendasi_Teknis.md`](../../docs/deeptalk-ai/DeepTalk_AI_Rekomendasi_Teknis.md): rekomendasi teknis awal. Sebagian digantikan oleh 02 (lihat 01 §5)

## Repository terkait

| Repo | Peran |
|---|---|
| `deeptalk-ai` (repo ini) | `gateway/` (NestJS), `agent/` (Python ADK), `content/`, `infra/`, `docs/` |
| `deeptalk-api-v3` | Token exchange AI + JWKS, data psikolog/asesmen/booking, endpoint internal, push, webhook siklus hidup akun |
| `deeptalk-web-v2` | Client pengguna (web), route `/teman-ai` |
| `deeptalk-app-v2` | Client pengguna (mobile) |
| `psikolog-deeptalk-dashboard` | Handoff, kurasi persona dan konten klinis, evaluasi, tinjauan keamanan |
| `psikolog-app-v2` | Notifikasi handoff |

## Konvensi

- Instruksi untuk AI agent ada di [`AGENT.md`](../AGENT.md) (dimuat `CLAUDE.md`), dengan skill di `.claude/skills/` (`task-recap`, `gateway`, `agent`).
- Setiap pekerjaan yang mengubah kode, konfigurasi, infrastruktur, atau dokumen di repo ini dicatat di `docs/tasks/YYYYMMDD-<nama-task>.md`: daftar pekerjaan dibuat di awal, status selesai/belum ditandai di akhir, dengan bagian Rekap Status.
- Blocker dicatat satu file per blocker di `docs/blockers/<nama-blocker>.md` dan didaftarkan di [blockers/README.md](blockers/README.md).
- Perubahan di repo lain mengikuti konvensi repo tersebut (`AGENT.md`, `AGENTS.md`, `docs/phase/`).
- Status phase diperbarui di [03-phase.md](03-phase.md) saat item berpindah status.
