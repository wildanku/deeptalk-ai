# Persiapan Repo Publik (Penilaian Kompetisi)

**Tanggal:** 2026-10-18
**Phase:** —
**Komponen:** docs
**Recap terkait:** [20261011-phase-6-hardening-produksi.md](20261011-phase-6-hardening-produksi.md)

## Tujuan

Repo akan dibuat publik untuk penilaian kompetisi. Pastikan tidak ada kredensial atau informasi internal yang rawan ikut terbuka.

## Daftar Pekerjaan

- [x] Audit file yang di-track dan riwayat git untuk kredensial (kunci, token, private key, DSN, `.env`, tfstate/tfvars, key service account) — tidak ditemukan; satu-satunya DSN berpassword adalah Postgres lokal di `.env.example`
- [x] Audit data pribadi dan informasi internal (email, nomor telepon, ID akun, path lokal, ID proyek GCP) — data uji di kode sintetis; ID proyek dan akun billing hanya placeholder
- [x] Hapus dokumen yang merinci kerentanan terbuka di sistem lain (`docs/security/tinjauan-internal-20261011.md`, `docs/blockers/temuan-keamanan-repo-lain.md`)
- [x] Samarkan rujukan ke dokumen tersebut (`docs/03-phase.md`, `docs/blockers/README.md`, recap Phase 6)
- [x] Samarkan path lokal dan ID akun uji di recap
- [x] Bersihkan riwayat git agar dokumen yang dihapus tidak terbaca dari commit lama — riwayat diganti satu commit (orphan) dan di-push ke remote publik yang masih kosong; riwayat lama disimpan di branch lokal `backup/pre-public-history` (tidak di-push)

## File yang Diubah

- `docs/security/tinjauan-internal-20261011.md`, `docs/blockers/temuan-keamanan-repo-lain.md` — dihapus; disimpan internal di luar repo publik.
- `docs/03-phase.md`, `docs/blockers/README.md`, `docs/tasks/20261011-phase-6-hardening-produksi.md` — rujukan dan rincian kerentanan disamarkan.
- `docs/tasks/20261015-topologi-deployment-cloud-tasks.md`, `docs/tasks/20261016-uji-lokal-alur-pengguna-web.md`, `docs/tasks/20261016-rekomendasi-psikolog.md` — path lokal dan ID akun uji dihapus.

## Keputusan

- Rincian kerentanan yang masih terbuka di sistem lain tidak dipublikasikan; status exit criteria Phase 6 tetap `[ ]` dengan keterangan umum.
- Nama pemangku kepentingan dan domain produk di dokumen dibiarkan (bukan rahasia).

## Validasi

- [x] `git grep` untuk nama file yang dihapus, ID akun uji, path lokal, dan nama paket rentan di `docs/` — 0 kecocokan.

## Blocker

Tidak ada.

## Follow-up

- [ ] Ubah visibilitas repo GitHub menjadi publik (dilakukan pemilik repo).

## Rekap Status

**Status:** ✅ Selesai
**Progres:** 6/6 item selesai
