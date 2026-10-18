# Konten Klinis Gelombang Pertama Belum Ada

**Status:** `OPEN`
**Dibuka:** 2026-10-10 · **Diselesaikan:** —
**Jenis:** konten-psikolog
**Pemilik penyelesaian:** psikolog (konten), Pak Novri (Q1), psikolog + hukum (Q5), psikolog (Q6)
**Memblokir:** Phase 2 — persona, protokol krisis, frasa L1, gerbang evaluasi safety, exit criteria "persona berbeda gaya"; Phase 3 — pustaka routine, pemetaan asesmen, daftar psikolog handoff, alur Rani di `staging`
**Muncul di task:** [20261010-phase-2-3-percakapan-keamanan-output.md](../tasks/20261010-phase-2-3-percakapan-keamanan-output.md)

## Masalah

Phase 2 dan 3 sudah dibangun, tetapi seluruh konten klinis yang dimuat runtime masih seed `DRAFT` buatan engineering (03 §1, §4). Konten `DRAFT` hanya aktif bila `CONTENT_ALLOW_DRAFT=true`, yang ditolak env validation di production. Tanpa konten `approved`, gateway di production tidak punya persona untuk ditawarkan dan memakai safety floor engineering (frasa L1 fallback dan protokol yang merujuk ke 112).

## Dampak

- Tidak ada persona yang bisa diaktifkan di `staging`/`prod` (Q1 belum diputuskan).
- Protokol `crisis`/`elevated` dan hotline (Q5, Q6) belum diverifikasi; seed menandai kontak `verified: false`.
- Recall L1 hanya terbukti pada 14 studi kasus sintetis; gerbang evaluasi safety belum punya set final.
- Kartu routine, asesmen, dan handoff tidak akan pernah muncul di production: pustaka routine `DRAFT`, `assessment_mappings` dan `handoff_psikologs` kosong.
- Aturan global dan prompt agent (`agent/prompts/*/v0-draft.md`) belum ditinjau psikolog.

## Yang sudah dicoba / diketahui

- Format setiap jenis konten sudah ditetapkan dan divalidasi zod di `gateway/src/content/content.schemas.ts`; contohnya ada di `content/` (lihat `content/README.md`).
- `pnpm run content:seed` bersifat append-only: versi baru ditambahkan dan versi `approved` menggantikan yang aktif tanpa deploy ulang (cache 60 detik).
- Persona `DRAFT` memakai ID psikolog palsu; persona asli butuh `psikolog_id` v3 yang sebenarnya.

## Yang dibutuhkan untuk lepas

- [ ] Q1 — daftar psikolog gelombang pertama (2–4), lalu Persona Card per psikolog (kuesioner + studi kasus, 03 §4).
- [ ] Q5 — teks protokol `crisis` dan `elevated`, serta kebijakan tindak lanjut setelah krisis.
- [ ] Q6 — hotline yang sudah diverifikasi (kandidat: 112, SEJIWA 119 ext. 8).
- [ ] Frasa L1 (termasuk slang dan variasi ejaan) dan set studi kasus evaluasi final dengan label `crisis`/`elevated`/`normal`.
- [ ] Materi pengetahuan per topik (stres kerja, kecemasan, tidur, rokok, …).
- [ ] Pustaka routine per topik, termasuk topik yang dikecualikan.
- [ ] Pemetaan topik → asesmen v3, dan daftar psikolog yang bersedia menerima handoff.
- [ ] Tinjauan aturan global dan prompt agent.
- [ ] Semua item di atas berstatus `approved` dengan `approved_by`; sampai portal Phase 5 ada, engineering memasukkannya lewat `content/` + `content:seed`.

## Opsi dan usulan

| Opsi | Konsekuensi |
|---|---|
| Psikolog menulis langsung dalam format `content/` dibantu engineer | Cepat; perlu sesi pendampingan dan pencatatan siapa menyetujui |
| Tunggu portal kurasi Phase 5 | Tidak ada konten di `staging` sampai Phase 5; uji alur Rani mundur |

**Usulan default:** opsi pertama untuk gelombang pertama, lalu pindah ke portal Phase 5.

## Riwayat

- 2026-10-10 — dibuka dari task Phase 2–3.
- 2026-10-11 — task Phase 4–5: kuesioner persona (`persona_questionnaire`) dan studi kasus (`case_study`) juga konten DRAFT yang harus disusun tim psikolog. Portal kurasi sudah ada: psikolog bisa menyusun personanya sendiri di dashboard, dan reviewer klinis menyetujui konten lain (penyetuju ≠ penulis); versi engineering tidak bisa disetujui. Pemetaan asesmen sekarang konten berversi `assessment_mapping`. Butuh juga penunjukan reviewer klinis (`roles:grant`).
- 2026-10-14 — task Phase 7: `pnpm run rollout:readiness` gagal selama protokol, frasa L1, teks consent, dan persona belum `approved` — konten ini syarat naik ke tahap 7.1.
- 2026-10-14 — task Phase 8: kind baru `topic` dan `instrument` (check-in, skrining, inventori kepribadian, termasuk butir keamanan) — seed DRAFT di `content/topics/`, `content/instruments/`; placeholder routine `tidur` dan `kecemasan`. Keputusan isinya di [keputusan-phase-8-lanjutan](keputusan-phase-8-lanjutan.md).

## Penyelesaian

—
