# content/

Seed awal konten klinis, **hanya untuk bootstrap** database `ai_content_versions` (02 §8, A12). Setelah seed pertama, database menjadi sumber kebenaran dan psikolog mengelola konten lewat `psikolog-deeptalk-dashboard`. File di sini tidak dibaca saat runtime.

| Folder | Isi | Pemilik | Memblokir |
|---|---|---|---|
| `personas/` | Persona Card per psikolog (nada, teknik, gaya bertanya, few-shot) | Psikolog persona | Phase 2 (draft), Phase 5 (persetujuan) |
| `protocols/` | Definisi level risiko, protokol krisis, hotline (Q5, Q6) | Psikolog | Phase 2 |
| `l1-phrases/` | Frasa dan pola krisis bahasa Indonesia untuk safety L1 | Psikolog + engineer | Phase 2 |
| `routine-library/` | Pustaka item Daily Routine | Psikolog | Phase 3 |
| `knowledge/` | Materi pengetahuan klinis per topik | Psikolog | Phase 2 |
| `assessment-mappings/` | Pemetaan topik → asesmen (kind `assessment_mapping`, satu item per topik) | Psikolog | Phase 3 |
| `consents/` | Teks consent `service` dan `ai_training` (kind `consent_text`; versi = `text_version`) | Konsultan hukum | Phase 4 |
| `persona-questionnaire/` | Kuesioner pendekatan untuk kurasi persona | Psikolog | Phase 5 |
| `case-studies/` | Studi kasus sintetis yang dijawab setiap psikolog persona (`few_shot` / `eval`) | Psikolog | Phase 5 |
| `topics/` | Label dan deskripsi topik untuk pengguna; `routine_allowed` (kind `topic`, `ref_id` = ID topik) | Psikolog | Phase 8 |
| `instruments/` | Check-in harian, skrining berkala, inventori kepribadian: butir, skala, skor, rentang hasil, butir keamanan (kind `instrument`) | Psikolog | Phase 8 |

Aturan:

- **Engineering tidak menulis konten klinis final.** Konten contoh untuk pengembangan tetap berstatus `DRAFT`, diberi penanda yang jelas di UI, dan tidak pernah berstatus `approved`; teks contoh tidak boleh memberi kesan bahwa instrumen sudah tervalidasi.
- Instrumen dapat menyediakan salinan `translations.en` untuk judul, pengantar, disclaimer, skala, butir, dan hasil. API memilih bahasa dari locale situs (`id` atau `en`) dan kembali ke teks dasar bahasa Indonesia bila salinan tidak tersedia.
- Konten berstatus selain `approved` tidak pernah aktif di `prod`.
- Format: satu file JSON per `ref_id` (`kind`, `ref_id`, `version`, `status`, `body`), atau `items[]` untuk pustaka routine. `body` divalidasi skema di `gateway/src/content/content.schemas.ts`.
- Seed: `pnpm run content:seed` di `gateway/`. Selalu masuk sebagai `draft` dengan penulis `seed:content`; versi yang sudah ada tidak pernah ditimpa (append-only) — ubah isi = naikkan `version`.
- Seed langsung inventori contoh bilingual versi 3 tersedia di `gateway/scripts/sql/seed-personality-inventory-v3.sql`. Skrip hanya menambah status `draft`; skrip menolak versi 3 yang sudah ada dengan isi berbeda dan tidak menyetujui konten.
- Seed langsung ketentuan layanan bilingual versi 7 tersedia di `gateway/scripts/sql/seed-service-consent-v7.sql`. Terjemahan Inggris ikut disajikan oleh API, sehingga web tidak perlu mengetahui nomor versi consent; skrip hanya menambah status `draft` dan tidak mengubah atau menyetujui versi lama.
- Versi dari seed **tidak pernah bisa disetujui** (Phase 5). Konten final masuk sebagai versi baru lewat dashboard (Konten klinis) dan disetujui reviewer klinis lain.
- `evals/` berisi studi kasus **sintetis** untuk gerbang evaluasi safety.
- Jangan menyimpan percakapan pengguna nyata atau data pribadi di sini.
