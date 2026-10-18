# e2e/

Skenario E2E lokal untuk Phase 1–3, tanpa GCP: v3 tiruan (memakai `AiTokenService` **asli** dari build `deeptalk-api-v3` untuk token dan JWKS, plus data deterministik untuk direktori, katalog, booking, dan pencatat notifikasi), agent dengan model lokal, dan **dua** instance gateway berbagi Postgres dan Redis.

```bash
# Prasyarat: Postgres + Redis lokal, migrasi gateway sudah diterapkan, konten DRAFT di-seed,
# gateway sudah di-build (pnpm run build), agent sudah `uv sync`, v3 sudah di-build.
cd e2e
V3_DIR=../../deeptalk-api-v3 \
E2E_DATABASE_URL=postgresql://localhost:5432/deeptalk_ai_dev \
./run.sh                     # semua skenario, atau: ./run.sh phase2-3 limits resilience phase4-5 phase8 phase9
```

`V3_DIR` harus berisi build v3 yang **memuat modul AI** (`dist/modules/ai/ai-token.service.js`, saat ini di cabang `feat/ai-phase-1`). Bila checkout v3 sedang di cabang lain (mis. `deploy/prod`), fake v3 gagal start (`MODULE_NOT_FOUND` di `.state/fake-v3.log`) dan semua socket ditolak `UNAUTHORIZED`. Jangan pindah cabang di checkout itu; build salinan terpisah:

```bash
D=$(mktemp -d) && git -C ../../deeptalk-api-v3 archive feat/ai-phase-1 | tar -x -C "$D" \
  && ln -s "$PWD/../../deeptalk-api-v3/node_modules" "$D/node_modules" && (cd "$D" && npx nest build)
# error tipe dari Prisma client yang belum di-generate tidak menghalangi: JS tetap dikeluarkan
V3_DIR="$D" E2E_DATABASE_URL=... ./run.sh
```

| Skenario | Yang diuji |
|---|---|
| `phase2-3.mjs` | Quick Chat + router, fan-out lintas instance, routine (usulan → edit → log → ringkasan), kartu asesmen, handoff (hapus bagian → setuju → tautan booking → notifikasi psikolog → baca oleh psikolog yang benar/salah), L3, krisis L1 + protokol, risiko lengket, pengingat scheduler, pengaturan memori |
| `limits.mjs` | Kuota habis (termasuk dua perangkat bersamaan), pesan krisis saat kuota habis, peringatan/penutupan waktu aktif dan tenggang, ringkasan memori terenkripsi |
| `resilience.mjs` | Agent mati (gagal tertutup + protokol L1), restart semua instance gateway di tengah sesi (timer tetap benar) |
| `load.mjs` (`./run.sh load`) | Uji beban: `LOAD_USERS` pengguna bersamaan × `TURNS` giliran di dua gateway; token pertama p50/p95/p99, waktu balasan, tingkat error, krisis → protokol; laporan di `.state/load-report.json`. Di macOS jalankan dengan `caffeinate -i` (host yang tidur membuat stall palsu ±26 dtk) |
| `phase4-5.mjs` | Consent layanan (tolak tanpa simpan, krisis tetap dapat protokol, versi teks, persetujuan ulang), consent pelatihan (tawaran, cabut berlaku mundur), gerbang usia, hapus riwayat, hapus/merge akun lewat webhook dan feed tarik, peran psikolog/reviewer, kurasi persona sampai `approved`, nonaktifkan persona di sesi berjalan, kurasi konten (empat mata, seed tidak bisa disetujui, CHECK DB), tinjauan keamanan tanpa identitas, daftar handoff psikolog |
| `phase8.mjs` | Cek diri: daftar/detail instrumen (tanpa ambang keamanan), gerbang consent, check-in (terenkripsi, koreksi hari yang sama, riwayat melewati baris rusak), skrining (validasi, rentang + saran asesmen, interval 409, butir keamanan → protokol + kejadian tanpa isi), inventori per dimensi, label topik, Cakupan (peran reviewer), dampak `self_checks`, hapus per entri/semua, hapus akun, merge (bentrok tanggal) |
| `phase9.mjs` | Pemanfaatan data (sintetis): consent `legacy_counseling`, addendum psikolog, gerbang (`data:gate`) menolak job tanpa switch/DPIA/etik, `dataset collect` (hanya consent pelatihan, bukan krisis, disamarkan + terenkripsi, idempoten), `import-legacy` (consent pengguna + psikolog; diam ≠ setuju), tinjauan `data_reviewer` tanpa identitas, ekspor per tujuan (izin psikolog, fine-tuning butuh gerbang sendiri), pencabutan → ditarik, hapus akun, cabut gerbang |

Data uji memakai user `itest-*`, psikolog `PSY-*` (token psikolog dari v3 tiruan; `POST /v2/psikolog/ai/access` dengan sesi `psy-session-<ID>` untuk uji BFF dashboard), fixture `ASM-TEST`/`PSY-TEST`, dan feed akun tiruan (`POST /test/account-events`), dibersihkan oleh `stack.sh up`/`down`. Kunci dan token dibuat ulang di `.state/` (diabaikan git). **Jangan** arahkan `E2E_DATABASE_URL` ke database bersama.
