# DPIA Phase 9 — Bagian Engineering (Draf)

**Untuk:** konsultan hukum (pemilik DPIA) dan peninjau etik eksternal.
**Status:** draf engineering. DPIA lengkap (dasar hukum, penilaian kebutuhan dan proporsionalitas, konsultasi) ditulis dan ditandatangani konsultan hukum ([blocker](../blockers/teks-hukum-consent-privasi-dpia.md)). Gerbang `dpia` hanya dibuka setelah dokumen final bernomor ada.

Dokumen ini menjelaskan apa yang dilakukan sistem terhadap data, supaya penilai tidak perlu membaca kode. Rincian langkah ada di [pemanfaatan-data](pemanfaatan-data.md).

## 1. Pemrosesan yang dinilai

Memakai isi percakapan untuk mengevaluasi dan meningkatkan Teman AI, dari dua sumber:

1. **Sesi Teman AI** dari pengguna yang menyetujui consent pelatihan.
2. **Riwayat konseling chat lama** dengan psikolog DeepTalk, dari pengguna yang menyetujui consent `legacy_counseling`. Psikolog yang menangani juga harus menyetujui addendum.

Kategori data: data kesehatan, yaitu data pribadi spesifik menurut UU PDP. Isi konseling juga terikat kerahasiaan profesi.

## 2. Inventaris dan alur data

| Tahap | Data | Lokasi | Bentuk | Akses |
|---|---|---|---|---|
| Sumber Teman AI | Pesan sesi | Postgres AI (VM GCE + Dokploy) `asia-southeast2` | AES-256-GCM, kunci KMS (AAD = ID baris) | Gateway |
| Sumber lama | Berkas ekstraksi | Bucket terbatas `asia-southeast2` (diputuskan saat ekstraksi) | Belum disamarkan | Operator ekstraksi, sementara |
| De-identifikasi | Teks per pesan | Sensitive Data Protection, lokasi `asia-southeast2` (`parent` request) | Nilai diganti `[JENIS_INFO]` | Akun layanan gateway |
| Penyimpanan kandidat | Teks yang sudah disamarkan + hitungan temuan | Postgres AI, `ai_dataset_items` | Terenkripsi (AAD = ID item); `user_id` hanya untuk pencabutan | Gateway |
| Tinjauan | Teks yang sudah disamarkan | Dashboard psikolog lewat BFF | Tanpa identitas pengguna | Peran `data_reviewer` |
| Ekspor | Item disetujui per tujuan | Berkas JSONL di bucket terbatas | Tanpa ID pengguna/psikolog | Operator yang tercatat di `ai_dataset_exports` |
| Pemakaian | Evaluasi, contoh gaya, fine-tuning | Gemini Enterprise Agent Platform region `us` (sama dengan pemrosesan percakapan) | — | Tim AI |

Log, trace, dan metrik hanya berisi hitungan dan nama gerbang, tidak pernah isi (diuji di E2E Phase 9).

## 3. Kontrol yang dibangun

| Risiko | Kontrol | Diverifikasi |
|---|---|---|
| Data dipakai sebelum ada persetujuan sah | `DATASET_ENABLED` + gerbang `dpia` dan `ethics_review` yang dicatat manusia (append-only, dengan rujukan dokumen); setiap job mengecek | Unit + E2E |
| Pengguna tidak setuju tetapi datanya ikut | Consent dicek saat pengumpulan/impor **dan** saat ekspor; diam ≠ setuju | Unit + E2E |
| Respons psikolog dipakai tanpa izin | Addendum berversi, pilihan per pemakaian; tanpa jawaban berarti menolak | Unit + E2E |
| Identitas tersisa di teks | Sensitive Data Protection + tinjauan manual wajib sebelum dipakai | Unit (klien DLP tiruan); E2E dengan penyamar lokal |
| Penyamar lemah di produksi | `DATASET_DEID=local` ditolak di production | Validasi env |
| Percakapan krisis dipakai | Sesi `crisis` tidak pernah dikumpulkan (Konsep §7.2) | E2E |
| Pencabutan tidak dihormati | Item yang belum diekspor dihapus; yang sudah diekspor ditarik dan isinya dihapus | E2E |
| Hapus akun | Semua item pengguna dihapus | E2E |
| Akses berlebihan | Peran `data_reviewer` terpisah; reviewer tidak melihat identitas | E2E |
| Ekspor bocor | Tanpa ID, izin berkas `0600`, jejak audit hitungan | E2E |

## 4. Yang harus diverifikasi sebelum gerbang `dpia` dibuka

- [ ] Lokasi pemrosesan Sensitive Data Protection benar-benar di `asia-southeast2` untuk request dengan `parent` lokasi itu, sesuai ketentuan Google Cloud terbaru.
- [ ] Daftar jenis info (`PERSON_NAME`, `LOCATION`, `INDONESIA_NIK_NUMBER`, dan lainnya di `gateway/src/datasets/deid.ts`) valid di katalog DLP dan cukup untuk teks percakapan berbahasa Indonesia. Uji dengan sampel sintetis yang ditulis psikolog.
- [ ] Ketentuan Agent Platform: data pelanggan tidak dipakai melatih model Google. Pemrosesan model di region `us` (keputusan Q7) → transfer ke luar negeri (UU PDP Pasal 56). `gemini-4-argon` tidak mendukung tuning; bila fine-tuning diputuskan, model dan lokasinya ditetapkan saat gerbang `fine_tuning_go`.
- [ ] Bucket ekspor dan ekstraksi: region, akses IAM, retensi, log akses.
- [ ] Retensi item dataset dan berkas ekspor (ikut Q10).
- [ ] Prosedur bila tinjauan menemukan identitas yang lolos (hapus item, catat insiden).

## 5. Pertanyaan untuk tinjauan etik

- Apakah memakai riwayat konseling lama, meskipun dengan persetujuan baru, sejalan dengan ekspektasi saat konseling dilakukan?
- Apakah ada kelompok yang perlu dikecualikan selain sesi krisis (misalnya pengguna di bawah 18 tahun saat konseling, topik tertentu)?
- Apakah penjelasan "data yang sudah dipakai melatih model tidak selalu bisa dihapus" cukup jelas bagi pengguna?
- Siapa yang boleh menjadi `data_reviewer`, dan perlukah empat mata untuk persetujuan item?
