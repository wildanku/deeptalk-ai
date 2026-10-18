# Keputusan Q4: Pengguna di Bawah 18 Tahun

**Status:** `OPEN`
**Dibuka:** 2026-10-11 · **Diselesaikan:** —
**Jenis:** keputusan
**Pemilik penyelesaian:** Pak Novri + konsultan hukum
**Memblokir:** Phase 4 — "Gerbang usia … terapkan keputusan Q4" (final)
**Muncul di task:** [20261010-phase-4-5-consent-data-portal-psikolog.md](../tasks/20261010-phase-4-5-consent-data-portal-psikolog.md)

## Masalah

Q4 ([01 §6](../01-review-dokumen-dan-codebase.md)) belum diputuskan. Usulan: pengguna di bawah 18 tahun diblokir sampai ada mekanisme wali.

## Dampak

Gerbang usia sudah berjalan dengan usulan itu (`AI_MIN_AGE=18`, bisa diubah tanpa rilis kode). Bila keputusannya berbeda (batas lain, atau izin wali), perlu alur tambahan.

## Yang sudah dicoba / diketahui

- Tanggal lahir kosong → pengguna diminta mengisinya (disimpan di profil v3). Di bawah batas → `AGE_RESTRICTED`. Pesan krisis tetap menerima protokol, dan layar bantuan selalu terbuka.

## Yang dibutuhkan untuk lepas

- [ ] Keputusan Q4: batas usia, dan apakah ada jalur izin wali.

## Opsi dan usulan

| Opsi | Konsekuensi |
|---|---|
| Blokir < 18 (diterapkan) | Tidak ada kerja tambahan |
| Izin wali | Alur verifikasi wali di v3, web, dan app — perlu desain |

**Usulan default:** blokir < 18 sampai mekanisme wali tersedia.

## Riwayat

- 2026-10-11 — dibuka dari task Phase 4–5.

## Penyelesaian

—
