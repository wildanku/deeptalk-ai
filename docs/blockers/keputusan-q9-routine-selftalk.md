# Keputusan Q9: Daily Routine vs SelfTalk

**Status:** `OPEN`
**Dibuka:** 2026-10-10 · **Diselesaikan:** —
**Jenis:** keputusan
**Pemilik penyelesaian:** Pak Novri
**Memblokir:** Phase 3 — "Keputusan Q9 (hubungan dengan SelfTalk) diterapkan"
**Muncul di task:** [20261010-phase-2-3-percakapan-keamanan-output.md](../tasks/20261010-phase-2-3-percakapan-keamanan-output.md)

## Masalah

Q9 ([01 §6](../01-review-dokumen-dan-codebase.md)) belum diputuskan: apakah Daily Routine berdiri sendiri atau terintegrasi dengan SelfTalk (mood tracker dan jurnal harian di v3).

## Dampak

Layar Rutinitas dibangun dengan usulan default ("berdiri sendiri"): data di Cloud SQL AI (`ai_user_routines`, `ai_routine_logs`), layar `/teman-ai/rutinitas` di web dan app. Tautan dari SelfTalk belum dibuat. Bila keputusannya "terintegrasi", log harian dan UI perlu dipindah atau disinkronkan ke SelfTalk.

## Yang sudah dicoba / diketahui

- Default yang diterapkan tidak menyentuh tabel SelfTalk di v3, jadi tidak ada yang perlu dibongkar di v3 bila keputusan berubah.

## Yang dibutuhkan untuk lepas

- [ ] Keputusan Q9 dari Pak Novri.
- [ ] Bila "berdiri sendiri, dengan tautan dari SelfTalk": tambahkan tautan di layar SelfTalk web dan app.
- [ ] Bila "terintegrasi": rancangan sinkronisasi log routine ↔ SelfTalk (02 dan 03 diperbarui dulu).

## Opsi dan usulan

| Opsi | Konsekuensi |
|---|---|
| Berdiri sendiri + tautan dari SelfTalk | Sudah dibangun; tinggal tautan |
| Terintegrasi dengan SelfTalk | Perubahan di v3, web, dan app; data routine lintas dua sistem |

**Usulan default:** berdiri sendiri, dengan tautan dari SelfTalk (sesuai 01 §6).

## Riwayat

- 2026-10-10 — dibuka dari task Phase 2–3.

## Penyelesaian

—
