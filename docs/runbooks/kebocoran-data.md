# Runbook: Dugaan Kebocoran Data

**Pemicu:** isi percakapan atau data pribadi ditemukan di tempat yang tidak semestinya (log, trace, alert, tiket, pihak luar), akses tidak sah ke database/secret, atau laporan pihak ketiga.

UU PDP mewajibkan pemberitahuan tertulis kepada subjek data dan lembaga paling lambat **3 × 24 jam** setelah kegagalan pelindungan data diketahui. Keputusan pemberitahuan ada di hukum, bukan engineering.

## Langkah

1. **Catat waktu diketahui** (jam mulai tenggat 72 jam). Beri tahu lead engineering, Pak Novri, dan konsultan hukum **segera**.
2. **Bendung:**
   - Rotasi secret yang terlibat (Secret Manager): `AI_SERVICE_TOKEN`, `INBOUND_WEBHOOK_TOKEN`, `SCHEDULER_TOKEN`, kredensial database; kunci JWT AI di v3 (`kid` baru, lihat `deeptalk-api-v3/docs/guidance/ai-token-exchange.md`).
   - Cabut akses IAM yang dicurigai; aktifkan break-glass hanya dengan catatan.
   - Bila isi percakapan ada di log: batasi akses bucket/log view, lalu hapus entri sesuai saran hukum (jangan hapus sebelum bukti diamankan).
3. **Lingkup:** jenis data (isi pesan = terenkripsi KMS di database; ringkasan; ID pengguna; metadata), jumlah pengguna, periode. Cloud Audit Logs untuk akses KMS; untuk Postgres AI di VM: log akses IAP SSH/OS Login ke VM, log audit Dokploy, dan log koneksi Postgres (`log_connections`).
4. **Kunci KMS:** bila kunci enkripsi pesan diduga bocor → nonaktifkan versi kunci yang terlibat setelah re-enkripsi (perlu job khusus — **belum ada**, lihat follow-up recap Phase 6).
5. **Pemberitahuan:** konsultan hukum memutuskan isi dan penerima pemberitahuan (pengguna, lembaga).
6. **Perbaikan dan tinjauan:** tambahkan uji yang mencegah kebocoran yang sama (mis. redaksi log, allowlist atribut trace).

## Latihan

Tabletop dengan hukum: skenario "isi pesan muncul di log aplikasi". Teknis lokal: E2E memeriksa log gateway/agent tidak memuat teks percakapan (0 kecocokan).
