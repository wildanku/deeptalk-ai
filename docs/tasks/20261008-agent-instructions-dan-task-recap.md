# Instruksi AI Agent dan Alur Dokumentasi Task

**Tanggal:** 2026-10-08
**Phase:** — (pendukung semua phase)
**Komponen:** docs, konfigurasi agent
**Recap terkait:** —

## Tujuan

Menyediakan instruksi untuk AI agent di repo `deeptalk-ai` (setara `AGENT.md`/`CLAUDE.md` di `deeptalk-api-v3`) beserta skill terkait, dan menetapkan alur wajib untuk mendokumentasikan setiap task (`docs/tasks/`) serta blocker (`docs/blockers/`).

## Daftar Pekerjaan

- [x] Baca dokumentasi yang ada (`docs/01`–`03`, `docs/README.md`) dan konvensi `deeptalk-api-v3` (`AGENT.md`, `CLAUDE.md`, skill `nest`, `docs/blocker.md`)
- [x] Buat `AGENT.md`: ringkasan, dokumen wajib baca, struktur target, aturan yang tidak boleh dilanggar, perintah, aturan lintas repo, alur dokumentasi task dan blocker, daftar skill
- [x] Buat `CLAUDE.md` yang memuat `AGENT.md`
- [x] Buat skill `task-recap` (alur, template recap task, template blocker)
- [x] Buat skill `gateway` (konvensi NestJS dari 02 §5–§9, §12)
- [x] Buat skill `agent` (konvensi Python + ADK dari 02 §7, §12)
- [x] Buat register `docs/blockers/README.md`
- [x] Perbarui konvensi di `docs/README.md` dan `docs/03-phase.md` §1
- [x] Tulis recap ini mengikuti template baru
- [ ] Verifikasi perintah `pnpm`/`uv` di `AGENT.md` dan skill — belum: `gateway/` dan `agent/` belum di-scaffold

## File yang Diubah

- `AGENT.md` — baru; instruksi utama untuk AI agent di repo ini.
- `CLAUDE.md` — baru; `@AGENT.md` agar Claude Code memuat instruksi yang sama (pola v3).
- `.claude/skills/task-recap/SKILL.md` — baru; alur dan template dokumentasi task dan blocker.
- `.claude/skills/gateway/SKILL.md` — baru; konvensi `gateway/`.
- `.claude/skills/agent/SKILL.md` — baru; konvensi `agent/`.
- `docs/blockers/README.md` — baru; register blocker.
- `docs/README.md` — bagian Konvensi merujuk `AGENT.md`, skill, dan `docs/blockers/`.
- `docs/03-phase.md` — §1 menyebut file blocker.

## Keputusan

- Nama file recap tetap `YYYYMMDD-<nama-task>.md` (kebab-case), konsisten dengan `docs/README.md` dan `deeptalk-api-v3`.
- Blocker ditulis satu file per blocker (berbeda dengan v3 yang memakai satu `docs/blocker.md`), dengan tabel register di `docs/blockers/README.md`.
- File recap dibuat di **awal** task berisi daftar pekerjaan, lalu ditandai di akhir, agar catatan tetap ada bila sesi terputus.
- Keputusan terbuka Q1–Q12 tidak disalin menjadi file blocker sekarang; dibuat saat benar-benar menahan sebuah task.

## Validasi

- [x] Path dan tautan relatif antar dokumen diperiksa manual.
- [ ] Perintah build/lint/test — tidak berlaku: belum ada kode.

## Blocker

Tidak ada.

## Follow-up

- [ ] Setelah scaffold `gateway/` dan `agent/` (Phase 1), perbarui bagian Perintah di `AGENT.md` dan skill `gateway`/`agent` dengan perintah yang benar-benar ada.
- [ ] Bila tim memakai agent selain Claude Code (Codex, Cursor), tambahkan `AGENTS.md` yang merujuk `AGENT.md`.

## Rekap Status

**Status:** 🟨 Sebagian
**Progres:** 9/10 item selesai

| Belum selesai | Alasan |
|---|---|
| Verifikasi perintah `pnpm`/`uv` | Belum: `gateway/` dan `agent/` belum di-scaffold |
