# Pemanfaatan Data Phase 9: Persetujuan, Ekstraksi, DPIA, dan Etik

**Status:** `OPEN`
**Dibuka:** 2026-10-14 · **Diselesaikan:** —
**Jenis:** hukum + keputusan + akses
**Pemilik penyelesaian:** Pak Novri (keputusan, kampanye consent, addendum), konsultan hukum (teks, DPIA), peninjau etik eksternal, kepala klinis (peninjau data)
**Memblokir:** seluruh Phase 9 di luar kode — tidak ada data asli yang boleh dikumpulkan, diimpor, atau diekspor
**Muncul di task:** [20261014-phase-9-data-dan-model.md](../tasks/20261014-phase-9-data-dan-model.md)

## Masalah

Perangkat Phase 9 sudah ada dan menolak berjalan tanpa persetujuan ([pemanfaatan-data](../data/pemanfaatan-data.md)). Yang belum ada adalah persetujuan itu sendiri dan akses ke data lama.

## Yang dibutuhkan untuk lepas

- [ ] Teks consent `legacy_counseling` (pengguna) dan `psikolog_addendum` (psikolog) ditulis dan disetujui hukum; saat ini DRAFT
- [ ] Kampanye permintaan consent ke pengguna lama: kanal, waktu, siapa yang dihubungi (diam ≠ setuju)
- [ ] Addendum kontrak psikolog ditandatangani; psikolog mengisi pilihan di dashboard
- [ ] Akses dan prosedur ekstraksi dari store `chat-service` yang sudah dipensiunkan (siapa, di mana, dihapus kapan) — di luar repo ini
- [ ] DPIA final bernomor ([bagian engineering](../data/dpia-phase-9-engineering.md)), termasuk verifikasi lokasi Sensitive Data Protection dan jenis info
- [ ] Tinjauan etik eksternal
- [ ] Penunjukan `data_reviewer`
- [ ] Bucket terbatas `asia-southeast2` untuk berkas ekstraksi dan ekspor (butuh [lingkungan-gcp-dev](lingkungan-gcp-dev.md))
- [ ] Keputusan fine-tuning (gerbang `fine_tuning_go`) — paling akhir, setelah evaluasi dan contoh gaya terbukti bermanfaat

## Riwayat

- 2026-10-14 — dibuka dari task Phase 9.

## Penyelesaian

—
