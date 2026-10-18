# Pemanfaatan Data Percakapan (Phase 9)

**Acuan:** Konsep §7.4, [03 Phase 9](../03-phase.md), [02 §9](../02-implementasi.md).
**Status:** perangkat siap dan teruji dengan data sintetis. Belum ada persetujuan yang sah, jadi belum ada data asli yang boleh disentuh ([blocker](../blockers/pemanfaatan-data-phase-9.md)).

Dokumen ini menjelaskan urutan langkah yang wajib, siapa yang melakukannya, dan perintah yang dipakai. Tidak ada langkah yang boleh dilompati, dan engineering tidak pernah membuka gerbang atas inisiatif sendiri.

## Sumber data dan syaratnya

| Sumber | Syarat pengguna | Syarat psikolog | Selalu dikecualikan |
|---|---|---|---|
| Sesi Teman AI | Consent `ai_training` aktif saat sesi dibuat **dan** saat ekspor | Contoh gaya dan pelatihan: psikolog pemilik persona mengizinkan pemakaian itu | Sesi yang pernah `crisis`; sesi `exclude_from_training` |
| Konseling chat lama (store `chat-service` yang sudah dipensiunkan) | Consent `legacy_counseling` aktif saat impor **dan** saat ekspor. Diam ≠ setuju | Psikolog yang menangani mengizinkan pemakaian itu (addendum) | Pengguna atau psikolog yang tidak menjawab |

## Urutan gerbang

| # | Langkah | Pemilik | Bukti | Dicatat dengan |
|---|---|---|---|---|
| 1 | Teks consent `legacy_counseling` dan addendum `psikolog_addendum` ditulis dan disetujui | Konsultan hukum, reviewer klinis | Versi `approved` di dashboard (Konten klinis) | Dashboard |
| 2 | Permintaan consent aktif ke pengguna lama (halaman "Persetujuan & data" di web/app, plus kanal yang diputuskan) | Pak Novri | Kampanye tercatat | — |
| 3 | Addendum kontrak psikolog ditandatangani; psikolog memilih pemakaian di dashboard ("Penggunaan data") | Pak Novri, psikolog | Kontrak + pilihan di `ai_psikolog_data_consents` | Dashboard |
| 4 | DPIA selesai dan ditandatangani | Konsultan hukum | Dokumen DPIA bernomor | `pnpm run data:gate -- dpia --by <nama> --ref <nomor dokumen>` |
| 5 | Tinjauan etik eksternal | Peninjau etik eksternal | Surat hasil tinjauan | `pnpm run data:gate -- ethics_review --by <nama> --ref <nomor surat>` |
| 6 | Peran `data_reviewer` untuk peninjau yang ditunjuk | Kepala klinis | Penunjukan tertulis | `pnpm run roles:grant <psikolog_id> data_reviewer --by <nama>` |
| 7 | `DATASET_ENABLED=true` dan `DATASET_DEID=dlp` di environment yang disetujui DPIA | Engineering | Perubahan konfigurasi lewat pipeline | Terraform/Cloud Run env |
| 8 | Fine-tuning (tahap terakhir) | Pak Novri + Wildan | Keputusan tertulis + jumlah item cukup | `pnpm run data:gate -- fine_tuning_go --by <nama> --ref <dokumen>` |

Mencabut gerbang (`--revoke`) langsung menghentikan semua job berikutnya. Status: `pnpm run data:gate -- status`.

## Alur kerja

```text
sumber ──► gerbang (DATASET_ENABLED + dpia + ethics_review) ──► consent pengguna + psikolog
      ──► de-identifikasi (Sensitive Data Protection, asia-southeast2) ──► simpan terenkripsi
      ──► tinjauan manual (data_reviewer) ──► ekspor per tujuan (cek consent ulang) ──► pemakaian
```

```bash
# di gateway/, dengan DATABASE_URL + kunci pesan environment itu
pnpm run dataset -- status
pnpm run dataset -- collect --limit 200                 # sesi Teman AI
pnpm run dataset -- import-legacy <ekstraksi.jsonl>     # konseling chat lama
pnpm run dataset -- export --purpose evaluation --out <berkas> --by <nama>
```

### Berkas ekstraksi data lama

Ekstraksi dari store `chat-service` **tidak** ada di repo ini dan baru boleh dibuat setelah langkah 1–5. Formatnya satu percakapan per baris:

```json
{"conversation_id":"…","user_id":"<ID pengguna v3>","psychologist_id":"<ID psikolog v3>","messages":[{"role":"user","text":"…"},{"role":"psikolog","text":"…"}]}
```

- Ekstraksi hanya mengambil percakapan **pengguna yang sudah setuju**. Penyaringan diulang saat impor, tetapi data orang yang tidak setuju sebaiknya tidak pernah keluar dari store lama.
- Berkas ekstraksi adalah data kesehatan yang belum disamarkan. Simpan di bucket terbatas di `asia-southeast2`, hapus segera setelah impor, dan catat siapa yang mengaksesnya.
- Bukan dari tabel chat v3 (01 §3, Konsep §7.4).

### Tinjauan manual

Peninjau (`data_reviewer`, berbeda dari reviewer klinis) membuka **Data pelatihan** di dashboard. Yang tampil hanya teks yang sudah disamarkan dan hitungan temuan per jenis; identitas pengguna tidak pernah tampil. Item ditolak bila:
- masih ada yang bisa mengenali seseorang (nama, tempat kerja, kejadian khas);
- isinya tidak layak untuk tujuan apa pun.

### Ekspor bertahap

| Tujuan | Syarat tambahan | Isi berkas |
|---|---|---|
| `evaluation` | — | ID item, sumber, `persona_id`, giliran yang sudah disamarkan |
| `style_examples` | Psikolog mengizinkan contoh gaya | sama |
| `fine_tuning` | Gerbang `fine_tuning_go` + minimal `DATASET_MIN_FINE_TUNING_ITEMS` item (default 1000); psikolog mengizinkan pelatihan | sama |

- Consent pengguna dicek ulang saat ekspor. Item yang consent-nya sudah dicabut langsung ditarik dan tidak ikut diekspor.
- Berkas tidak memuat ID pengguna atau psikolog. Berkas ditulis dengan izin `0600` dan menolak menimpa berkas lain.
- Simpan berkas di bucket terbatas `asia-southeast2`. Setiap ekspor tercatat di `ai_dataset_exports` (hitungan saja).
- Fine-tuning dijalankan di Gemini Enterprise Agent Platform region `us`, mengikuti lokasi pemrosesan model (keputusan Q7). `gemini-4-argon` tidak mendukung tuning, jadi model yang di-tuning dipilih saat gerbang `fine_tuning_go` dibuka. Prosedurnya belum dibangun.

## Pencabutan dan penghapusan

| Kejadian | Akibat |
|---|---|
| Pengguna mencabut `ai_training` | Item Teman AI miliknya: yang belum pernah diekspor dihapus; yang sudah diekspor ditandai `withdrawn` dan isinya dihapus |
| Pengguna mencabut `legacy_counseling` | Sama, untuk item konseling lama |
| Pengguna menghapus riwayat Teman AI | Item Teman AI ditarik seperti di atas |
| Akun dihapus | Semua item pengguna dihapus. Jejak ekspor tetap ada, tanpa ID pengguna |
| Akun di-merge | Item pindah ke akun tujuan |
| Psikolog mengubah pilihan | Berlaku di ekspor berikutnya |

Data yang sudah dipakai melatih model tidak selalu bisa dihapus dari model. Hal ini harus dijelaskan dengan jujur di teks consent (Konsep §7.2).
