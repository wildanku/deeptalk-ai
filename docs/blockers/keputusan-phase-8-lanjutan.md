# Keputusan Phase 8: Topik, Instrumen Cek Diri, Inventori, Imbalan, dan Ekspansi

**Status:** `OPEN`
**Dibuka:** 2026-10-14 · **Diselesaikan:** —
**Jenis:** keputusan + konten klinis
**Pemilik penyelesaian:** Pak Novri (produk), tim psikolog (konten), konsultan hukum (data kesehatan)
**Memblokir:** Phase 8 — mengaktifkan topik baru, check-in, skrining, inventori kepribadian di `prod`; imbalan consent pelatihan; ekspansi regional
**Muncul di task:** [20261014-phase-8-pengembangan-lanjutan.md](../tasks/20261014-phase-8-pengembangan-lanjutan.md)

## Masalah

Kode Phase 8 sudah ada dan teruji lokal dengan konten `DRAFT`. Yang belum ada adalah keputusan dan konten berikut. Tanpa itu tidak ada yang aktif di produksi.

1. **Topik tambahan.** Topik mana yang ditambah setelah `rokok` dan `stres_kerja`, dan apakah topik itu boleh punya routine. Kode menyediakan kind `topic` dan halaman Cakupan di dashboard. Placeholder `tidur` dan `kecemasan` hanya untuk pengembangan.
2. **Instrumen check-in dan skrining.**
   - Butir check-in harian.
   - Instrumen skrining yang dipakai, termasuk terjemahan bahasa Indonesia yang tervalidasi dan lisensinya.
   - Interval, rentang hasil dan teksnya, dan saran (asesmen/psikolog) per rentang.
   - **Butir keamanan** dan ambangnya. Jawaban di atas ambang selalu menampilkan protokol dan tercatat sebagai kejadian keamanan.
   - Teks pengingat "bukan diagnosis".
3. **Inventori kepribadian.**
   - Instrumen dan dimensinya, beserta tujuannya.
   - Saat ini hasil **hanya untuk pengguna**: tidak masuk percakapan, tidak untuk mencocokkan persona, tidak terlihat psikolog. Memakainya untuk personalisasi adalah profiling dan butuh keputusan serta teks consent tersendiri.
4. **Pemakaian data cek diri di percakapan.** Saat ini tidak dipakai (minimalisasi data). Bila diinginkan, misalnya "skor skrining naik, tawarkan bicara dengan psikolog", perlu keputusan klinis dan teks consent.
5. **Data cek diri dalam ringkasan handoff ke psikolog.** Saat ini tidak ikut.
6. **Imbalan bagi pengguna yang menyetujui consent pelatihan.** Konsep §7.1: "saat ini tidak ada imbalan". Kode tidak dibuat. Bila diputuskan ada, perlu tinjauan hukum karena imbalan bisa membuat consent tidak lagi bebas.
7. **Ekspansi Asia Tenggara.** Negara pertama, regulasinya, mitra krisis, dan bahasanya. Audit asumsi ada di [ekspansi-asia-tenggara](../rilis/ekspansi-asia-tenggara.md).
8. **Retensi data cek diri.** Ikut Q10 (`RETENTION_INSTRUMENT_RESPONSES_DAYS`, saat ini tidak diset, artinya tidak ada yang dihapus otomatis).

## Yang dibutuhkan untuk lepas

- [ ] Daftar topik tambahan + konten `topic`, `knowledge`, `routine_item`, `assessment_mapping` yang disetujui reviewer klinis
- [ ] Instrumen check-in dan skrining (`instrument`) disetujui, termasuk butir keamanan dan lisensi/terjemahan
- [ ] Keputusan tujuan inventori kepribadian + kontennya
- [ ] Keputusan pemakaian data cek diri di percakapan dan handoff (default: tidak)
- [ ] Keputusan imbalan consent pelatihan (default Konsep §7.1: tidak ada)
- [ ] Keputusan negara pertama untuk ekspansi
- [ ] Teks consent/kebijakan privasi mencakup data cek diri (lihat [teks-hukum-consent-privasi-dpia](teks-hukum-consent-privasi-dpia.md))

## Riwayat

- 2026-10-14 — dibuka dari task Phase 8.

## Penyelesaian

—
