# Keputusan Q10: Masa Retensi Percakapan, Ringkasan, dan Kejadian Keamanan

**Status:** `OPEN`
**Dibuka:** 2026-10-11 · **Diselesaikan:** —
**Jenis:** keputusan
**Pemilik penyelesaian:** konsultan hukum
**Memblokir:** Phase 4 — "Job retensi sesuai Q10"; perlakuan `ai_safety_events` saat akun dihapus
**Muncul di task:** [20261010-phase-4-5-consent-data-portal-psikolog.md](../tasks/20261010-phase-4-5-consent-data-portal-psikolog.md)

## Masalah

Q10 belum diputuskan. Job retensi harian sudah ada, tetapi masa simpan per jenis data belum boleh diisi tanpa keputusan hukum.

## Dampak

- `RETENTION_*_DAYS` kosong, jadi tidak ada data pribadi yang dihapus otomatis.
- Saat akun dihapus, `ai_safety_events` dipertahankan tanpa sesi (tidak bisa dikaitkan ke pengguna). Bila Q10 menyatakan harus dihapus juga, ubah `purgeUser` di `gateway/src/lifecycle/lifecycle.service.ts`.

## Yang dibutuhkan untuk lepas

- [ ] Masa simpan: pesan, ringkasan memori, kejadian keamanan, log routine, ringkasan handoff.
- [ ] Apakah kejadian keamanan tanpa identitas boleh dipertahankan setelah akun dihapus.

## Opsi dan usulan

| Opsi | Konsekuensi |
|---|---|
| Isi `RETENTION_*_DAYS` per lingkungan | Tanpa rilis kode |
| Retensi handoff | Belum ada env-nya; perlu tambahan kecil di `RetentionService` |

**Usulan default:** tunggu keputusan hukum; jangan mengisi angka sendiri.

## Riwayat

- 2026-10-11 — dibuka dari task Phase 4–5.
- 2026-10-14 — task Phase 8: data cek diri (`ai_instrument_responses`, jawaban dan skor terenkripsi) punya `RETENTION_INSTRUMENT_RESPONSES_DAYS` (tidak diset = tidak dihapus otomatis). Pengguna bisa menghapus per entri atau semuanya; ikut terhapus saat akun dihapus.
- 2026-10-14 — task Phase 9: item dataset (`ai_dataset_items`) dan berkas ekspor belum punya periode retensi; pencabutan consent dan hapus akun sudah menghapusnya.

## Penyelesaian

—
