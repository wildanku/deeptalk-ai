# Register Blocker — DeepTalk AI

Hal yang menghalangi pekerjaan dan tidak bisa diselesaikan engineer/agent sendiri: keputusan, akses, konten dari psikolog, pekerjaan repo/tim lain, atau verifikasi eksternal. Satu blocker = satu file `docs/blockers/<nama-blocker>.md`. Alur dan template: skill **task-recap** (`.claude/skills/task-recap/SKILL.md`).

- Sebelum memulai task, cek tabel ini.
- Blocker yang sama tidak dibuat dua kali: perbarui file yang ada dan tambahkan task baru di *Riwayat*-nya.
- File tidak dihapus saat selesai; statusnya diubah ke `RESOLVED`.
- Keputusan terbuka Q1–Q12 tercatat di [01-review §6](../01-review-dokumen-dan-codebase.md). Buat file blocker untuk salah satunya hanya saat keputusan itu benar-benar menahan sebuah task.

| Blocker | Status | Jenis | Memblokir | Pemilik | Dibuka |
|---|---|---|---|---|---|
| [tooling-lokal-terraform-docker](tooling-lokal-terraform-docker.md) | `OPEN` | akses | Verifikasi `infra/`, Dockerfile, docker-compose | Wildan | 2026-10-08 |
| [lingkungan-gcp-dev](lingkungan-gcp-dev.md) | `OPEN` | akses | Exit criteria Phase 1 di `dev`, Cloud KMS, ID token, Gemini, pipeline; Phase 2–3: L2, context caching, gerbang evaluasi, Cloud Scheduler | Wildan, Pak Novri | 2026-10-08 |
| [uji-client-ke-v3-dev](uji-client-ke-v3-dev.md) | `OPEN` | lintas-repo | Verifikasi layar Teman AI web dan app (Phase 1–4), dashboard dan psikolog-app (Phase 5) | Wildan | 2026-10-08 |
| [konten-klinis-gelombang-pertama](konten-klinis-gelombang-pertama.md) | `OPEN` | konten-psikolog | Persona, protokol krisis, frasa L1, set evaluasi, pustaka routine, pemetaan asesmen, daftar handoff (Q1, Q5, Q6) | Psikolog, Pak Novri | 2026-10-10 |
| [keputusan-q9-routine-selftalk](keputusan-q9-routine-selftalk.md) | `OPEN` | keputusan | Phase 3 — hubungan Daily Routine dengan SelfTalk | Pak Novri | 2026-10-10 |
| [teks-hukum-consent-privasi-dpia](teks-hukum-consent-privasi-dpia.md) | `OPEN` | eksternal | Phase 4 — teks consent final, kebijakan privasi, DPIA | Konsultan hukum, Pak Novri | 2026-10-11 |
| [keputusan-q4-usia](keputusan-q4-usia.md) | `OPEN` | keputusan | Phase 4 — batas usia final (default 18 diterapkan) | Pak Novri + hukum | 2026-10-11 |
| [keputusan-q10-retensi](keputusan-q10-retensi.md) | `OPEN` | keputusan | Phase 4 — masa retensi (job ada, periode kosong) | Konsultan hukum | 2026-10-11 |
| [keputusan-q5-q12-oncall-krisis](keputusan-q5-q12-oncall-krisis.md) | `OPEN` | keputusan | Phase 6 — on-call, kanal alert, latihan runbook, tindak lanjut krisis | Pak Novri, psikolog + hukum | 2026-10-11 |
| [keputusan-q3-peluncuran](keputusan-q3-peluncuran.md) | `OPEN` | keputusan | Phase 7 — strategi tahap, materi komunikasi, beta, tinjauan sampel | Pak Novri | 2026-10-14 |
| [keputusan-phase-8-lanjutan](keputusan-phase-8-lanjutan.md) | `OPEN` | keputusan + konten | Phase 8 — topik tambahan, instrumen cek diri, inventori, imbalan consent, ekspansi | Pak Novri, tim psikolog, hukum | 2026-10-14 |
| [pemanfaatan-data-phase-9](pemanfaatan-data-phase-9.md) | `OPEN` | hukum + keputusan + akses | Phase 9 — consent pengguna lama, addendum psikolog, ekstraksi `chat-service`, DPIA, tinjauan etik, fine-tuning | Pak Novri, hukum, peninjau etik, kepala klinis | 2026-10-14 |
| [latensi-l2-argon](latensi-l2-argon.md) | `OPEN` | keputusan | L2 Argon 2,6–4,2 dtk > `SAFETY_TIMEOUT_MS` 3.000 → pesan jatuh ke `elevated`; SLO token pertama | Wildan | 2026-10-15 |
