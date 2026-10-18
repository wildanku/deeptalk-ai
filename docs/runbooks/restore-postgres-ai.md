# Runbook: Backup dan Restore Postgres AI

Postgres AI adalah service Postgres tersendiri di VM GCE + Dokploy (bukan Cloud SQL, bukan database v3), di `asia-southeast2` ([topologi deployment](../../../docs/deeptalk-ai/topologi-deployment-151026.md)). Isi pesan, ringkasan, catatan routine, handoff, dan hasil cek diri terenkripsi di aplikasi (KMS), jadi backup juga terenkripsi untuk kolom-kolom itu. Restore butuh kunci KMS yang sama masih aktif.

## Konfigurasi yang diharapkan

| Lapisan | Pengaturan | Catatan |
|---|---|---|
| Backup logis | Dokploy → service Postgres AI → **Backups**: tujuan S3 = bucket GCS `asia-southeast2` (endpoint `https://storage.googleapis.com`, HMAC key milik service account khusus backup). Jadwal prod tiap 6 jam, dev/staging harian. | Bucket: *uniform access*, *public access prevention*, versioning, *retention policy* ≥ 7 hari, lifecycle hapus setelah 30 hari. Prefix per lingkungan |
| Snapshot disk | Jadwal snapshot harian disk persisten VM (resource policy GCE), lokasi penyimpanan `asia-southeast2`, retensi 7 hari | Memulihkan seluruh VM (semua service Dokploy), bukan satu database |
| Zona waktu | Parameter Postgres `timezone=UTC` | Lihat catatan driver tugas lokal di topologi; production tidak terpengaruh tetapi UTC menyamakan semua lingkungan |

**Batas yang diterima untuk tahap awal:** tidak ada HA dan tidak ada point-in-time recovery. RPO = jarak antar backup (≤ 6 jam di prod), RTO = waktu restore (diukur saat latihan). Bila RPO itu tidak bisa diterima, tambahkan WAL archiving (mis. `wal-g` ke GCS) atau pindah ke Cloud SQL; keduanya tidak butuh perubahan kode gateway.

## Restore (data rusak/hilang)

1. Tentukan titik waktu sebelum kerusakan (log aplikasi, Cloud Audit Logs) dan pilih berkas backup terakhir sebelum titik itu.
2. **Restore ke service baru**, jangan menimpa produksi: buat service Postgres baru di Dokploy (versi mayor sama, `timezone=UTC`, tanpa domain/port publik), lalu pulihkan berkas backup ke sana (fitur restore Dokploy, atau `pg_restore`/`psql` sesuai format berkas, dari shell VM lewat IAP SSH).
3. Verifikasi di service baru (read-only): `prisma migrate status` sesuai rilis; jumlah baris tabel utama masuk akal; dekripsi satu pesan uji dengan gateway non-produksi yang memakai kunci KMS yang sama.
4. Pilih: alihkan gateway ke service baru (ganti secret `DATABASE_URL`, deploy revisi baru) **atau** salin baris yang hilang. Keputusan oleh lead engineering.
5. Setelah pemulihan: penghapusan akun yang terjadi setelah titik restore harus diterapkan ulang. Jalankan ulang sinkronisasi akun dengan mengosongkan kursor `ai_sync_cursors` (`v3-account-events`); idempotensi memastikan tidak ada yang dobel.
6. Task Cloud Tasks yang tertunda (timer sesi, outbox) tetap berjalan dan merujuk ID dari data yang sekarang. Handler mengabaikan ID yang tidak ada, dan `outbox-sweep` mengirim ulang outbox `pending` dari data yang dipulihkan.

**VM hilang seluruhnya:** buat VM dari snapshot disk terakhir (IP internal yang sama, atau perbarui `DATABASE_URL`/`REDIS_URL`/`AI_GATEWAY_*`), lalu jalankan langkah 3 dan 5. Redis tidak perlu dipulihkan: isinya hanya adapter Socket.IO, lock, rate limit, dan cache.

## Uji restore berkala

Minimal per kuartal dan sebelum rilis publik: langkah 2–3 di `staging` (atau dari backup prod ke proyek terisolasi). Catat waktu yang dibutuhkan (RTO) dan titik data terakhir (RPO).

## Latihan

Belum bisa dilakukan: VM dan proyek GCP belum ada ([lingkungan-gcp-dev](../blockers/lingkungan-gcp-dev.md)).
