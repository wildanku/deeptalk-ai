# DeepTalk AI — Review Dokumen Sumber dan Codebase

**Versi:** 8 Oktober 2026 (rev. 2: produk produksi, tanpa konteks kompetisi) · **Status:** Draft untuk didiskusikan
**Dokumen sumber yang direview:**

- [`DeepTalk_AI_Konsep_dan_Eksekusi.md`](../../docs/deeptalk-ai/DeepTalk_AI_Konsep_dan_Eksekusi.md) (rev. 2, 7 Okt 2026)
- [`DeepTalk_AI_Rekomendasi_Teknis.md`](../../docs/deeptalk-ai/DeepTalk_AI_Rekomendasi_Teknis.md) (7 Okt 2026)

**Codebase yang direview:** `deeptalk-api-v3`, `deeptalk-web-v2`, `deeptalk-app-v2`, `psikolog-deeptalk-dashboard`, `psikolog-app-v2`.

Dokumen ini mencatat **apa yang ditemukan** dan **apa yang berubah dari dokumen sumber**. Rancangan implementasi ada di [02-implementasi.md](02-implementasi.md), urutan pengerjaan ada di [03-phase.md](03-phase.md).

---

## 0. Perubahan Konteks

Kedua dokumen sumber ditulis untuk prototipe AI Builder Cup 2026. **DeepTalk AI sekarang diperlakukan sebagai produk produksi**, tanpa pembagian sebelum/sesudah kompetisi dan tanpa tenggat waktu. Konsekuensinya:

| Bagian dokumen sumber | Status |
|---|---|
| Konsep §1–§8 (produk, keamanan, etika, consent, data) | **Tetap berlaku.** Menjadi acuan produk |
| Konsep §9 (konteks kompetisi), §10 (cakupan prototipe, jadwal, video demo), §12 (arah setelah kompetisi) | **Tidak berlaku** untuk dokumen ini |
| Konsep §11 (risiko) | Berlaku, kecuali risiko yang khusus kompetisi |
| Teknis §1 (tujuan "nilai di mata juri", "±11 hari") | **Diganti** dengan tujuan produksi (02 §1) |
| Teknis §12 (prioritas 7–18 Okt, "yang bisa ditunda") | **Diganti** oleh [03-phase.md](03-phase.md) |
| Item "roadmap" di Konsep §10 (persona seluruh psikolog, push, mobile, dan lain-lain) | Masuk cakupan rilis pertama atau pengembangan lanjutan (03 §2) |

Keputusan yang sebelumnya dibenarkan oleh penilaian juri (Google Cloud, ADK, multi-agen) sudah dinilai ulang dengan alasan produksi di 02 §4.

---

## 1. Ringkasan Temuan

| # | Temuan | Dampak | Rekomendasi singkat |
|---|---|---|---|
| T1 | **Fitur "Daily Routine" belum ada** di app, web, maupun API. Yang ada hanya SelfTalk (mood tracker dan jurnal harian) | Output 3 harus dibangun dari nol: data, API, UI web/app, dan pengingat push | Fitur baru di platform AI. Hubungan dengan SelfTalk diputuskan di Q9 |
| T2 | **Token pengguna v3 tidak bisa diverifikasi offline.** `UserTokenService.verify()` mengecek tanda tangan JWT *dan* sesi `user:session:<jti>` di Redis | Gateway yang hanya memvalidasi JWT akan melewatkan pencabutan token (logout) | *Token exchange*: v3 menerbitkan token AI berumur pendek, mengikuti pola `chat-access` |
| T3 | **Browser web tidak pernah memegang bearer DeepTalk.** `deeptalk-web-v2` menyimpannya di cookie httpOnly dan meneruskannya lewat BFF `/api/v2/*` | Browser tidak bisa membuka Socket.IO ke gateway dengan token pengguna | Sama dengan T2 |
| T4 | Opsi "shared secret" di dokumen teknis berarti **membagikan `JWT_SECRET` v3** ke layanan di cloud lain | Pihak yang memegang secret bisa membuat token login untuk semua pengguna | Token AI ditandatangani kunci asimetris (ES256) milik v3; gateway hanya memegang kunci publik |
| T5 | Token device FCM ada di tabel `devices` v3, dan pengiriman push sudah ditangani `NotificationDeliveryService` | "FCM langsung dari GCP" butuh duplikasi token device | Pengingat routine dikirim lewat endpoint internal v3 |
| T6 | v3 sudah punya pola yang bisa ditiru: Socket.IO dengan Redis adapter, token ber-scope, BullMQ, cron, direktori psikolog publik, katalog asesmen publik | Banyak pekerjaan di dokumen teknis tidak perlu dirancang dari nol | Salin pola dari `src/modules/chat`. Pakai endpoint publik yang ada |
| T7 | "Safety agent paralel dengan persona agent" belum mengatur **kapan token boleh dialirkan** | Respons persona bisa tampil sebelum vonis risiko keluar | *Safety gate* (02 §7.2) |
| T8 | Agen stateless, tetapi alur pengguna (Konsep §5) membutuhkan **memori lintas sesi** | Tidak jelas siapa yang menyusun konteks sesi sebelumnya | Ringkasan otomatis di akhir sesi, disuntikkan ke sesi berikutnya |
| T9 | **Siklus hidup akun** (hapus akun dan *merge* akun oleh admin, keduanya ada di v3) belum disentuh | Data AI bisa tertinggal atau salah pemilik, dan ini melanggar hak pengguna di UU PDP | Webhook dari v3 ke gateway. Syarat sebelum rilis |
| T10 | **Klaim "dilatih dengan ribuan data"** masih ada di 5 file web | Bertentangan dengan prinsip "Jujur dalam klaim" | Revisi copy (§4.2) |
| T11 | Data residensi: lokasi penyimpanan berbeda menurut tahap dan tidak sama dengan lokasi pemrosesan | Klaim di kebijakan privasi bisa keliru | Bedakan lokasi penyimpanan dan pemrosesan: beta disimpan di Singapura; production/rilis resmi di Indonesia; Gemini diproses di AS (`us`) dan disebut di consent serta kebijakan privasi |
| T12 | Handoff belum terhubung ke booking, dan psikolog **tidak** bisa membaca dokumen pra-konseling lewat API psikolog | Ringkasan pra-sesi tidak sampai ke psikolog di alur kerjanya | Tautkan ringkasan ke `bookings.id`; endpoint baca baru untuk psikolog |
| T13 | Dokumen sumber belum membahas **operasional produksi**: SLO, alerting, biaya per sesi, runbook insiden krisis, peluncuran bertahap | Produk kesehatan mental tanpa runbook krisis adalah risiko keselamatan | 02 §12 dan Phase 6–7 |

---

## 2. Review Dokumen Konsep dan Eksekusi

### 2.1 Yang sudah kuat dan dipertahankan

- Prinsip "AI memperluas jangkauan psikolog, bukan menggantikan", aturan penamaan ("DeepTalk AI dengan pendekatan …"), dan larangan diagnosis atau saran obat.
- Lapisan keamanan yang sama untuk semua persona, tidak bisa diubah persona, dan tidak terhalang kuota maupun consent.
- Dua consent terpisah; consent pelatihan opsional dan tidak ditawarkan saat risiko tinggi.
- Tidak memakai data konseling lama tanpa persetujuan yang sah.
- Proses kurasi persona lima tahap oleh psikolog (Konsep §3.2). Di produksi, proses ini menjadi workflow di dashboard psikolog.
- Batas sesi per sesi dengan penutupan yang lembut.

### 2.2 Gap dan inkonsistensi

| Bagian | Temuan | Rekomendasi |
|---|---|---|
| §1, §3.6 | "Daily Routine aplikasi DeepTalk" ditulis seolah sudah ada | Ganti narasinya menjadi fitur baru. Tentukan apakah log routine harian disatukan dengan layar SelfTalk (Q9) |
| §4 | "30 menit waktu aktif" belum didefinisikan, dan *idle timeout* 30 menit berpotensi tumpang tindih | Definisi konkret di 02 §6.3, ditambah batas wall-clock |
| §4 | Belum diatur apakah sesi krisis mengurangi kuota, dan apa yang terjadi saat pengguna dengan kuota habis mengirim pesan berisiko | Sesi krisis tidak mengurangi kuota. Saat kuota habis, pesan tetap melewati pemeriksaan keamanan sebelum pesan "kuota habis" |
| §3.3 | Belum diatur tindak lanjut setelah kejadian krisis (apakah DeepTalk menghubungi pengguna, siapa yang diberi tahu) | Keputusan psikolog dan hukum (Q5). Wajib sebelum rilis |
| §3.5 | Handoff menyebut "memesan sesi" tanpa kaitan ke booking v3 | Alur tautan ringkasan ke booking di 02 §5.5 |
| §3.5 | Psikolog tidak bisa membaca `pre_counseling_documents` lewat API psikolog | Endpoint baca ringkasan AI untuk psikolog. Jangan dicampur dengan dokumen pra-konseling (strukturnya berbeda) |
| §5 | Alur Rani butuh AI yang ingat sesi sebelumnya | Memori lintas sesi (T8) |
| §7.2 | `users.birth_date` di v3 **nullable** | Minta tanggal lahir saat onboarding AI bila kosong. Sikap untuk <18 tahun diputuskan sebelum rilis (Q4) |
| §7.2 | Kebijakan retensi percakapan belum ada | Keputusan hukum (Q10). Syarat sebelum rilis |
| §7.4 | "Ribuan riwayat chat konseling" | Chat terintegrasi v3 dimulai dengan data store baru. Riwayat lama ada di `chat-service` standalone yang sudah dipensiunkan |
| §7.4 | Tindak lanjut copy situs | Lokasi file di §4.2 |

---

## 3. Review Dokumen Rekomendasi Teknis

| Bagian | Isi dokumen | Temuan | Rekomendasi |
|---|---|---|---|
| §1 | Tujuan: nilai di mata juri, ±11 hari | Tidak relevan lagi | Tujuan produksi: aman, andal, bisa diaudit, bisa diskalakan ke seluruh psikolog (02 §1) |
| §2, §3 | "`deeptalk-api` tetap di AWS" | API yang relevan adalah `deeptalk-api-v3` (NestJS 11 + Prisma 7), di-deploy lewat **Dokploy**, dan menjadi satu-satunya API setelah cutover (K-D9). S3 di `ap-southeast-3` | Integrasi hanya ke v3. Lokasi host Dokploy perlu dikonfirmasi |
| §7 | Gateway memvalidasi JWT `deeptalk-api` | Lihat T2–T4 | `POST /v2/user/ai/access` dan `POST /v2/psikolog/ai/access` dengan ES256 |
| §7 | Endpoint `deeptalk-api` yang dibutuhkan | Direktori psikolog dan katalog asesmen **sudah ada dan publik**. Profil pengguna, hasil asesmen, verifikasi booking, dan push butuh endpoint internal baru | 02 §5 |
| §7 | "Membuat draft booking" | Booking v3 melibatkan voucher, pembayaran, dan peserta | Handoff mengarahkan ke alur booking yang ada, lalu ringkasan ditautkan ke booking yang terbentuk |
| §3, §4 | FCM + Cloud Scheduler di GCP | Lihat T5 | Cloud Scheduler memicu gateway menghitung pengingat yang jatuh tempo; push dikirim lewat v3 |
| §5.1 | Safety dan persona paralel | Lihat T7 | Safety gate + pengecekan output |
| §5.3 | Satu instance cukup, Redis menyusul | Tidak cukup untuk produksi | Multi-instance + Memorystore Redis adapter + timer sesi di BullMQ sejak awal |
| §6.1 | RAG Engine | Materi awal hanya beberapa topik | Mulai dengan materi di prompt (context caching). Pindah ke RAG ketika materi melewati ambang (02 §7.3) |
| §8 | Model data | Belum ada memori, audit keamanan, pemetaan asesmen, tautan booking, workflow persona, atau dukungan hapus/merge | 02 §8 |
| §9 | Keamanan | Belum ada retensi, backup, rate limit, kontrol biaya, atau runbook | 02 §9 dan §12 |
| §11 | `psychologist-portal/` baru dan lingkungan `demo` | Dashboard psikolog sudah ada. Lingkungan demo tidak relevan | Portal di `psikolog-deeptalk-dashboard`. Lingkungan: `dev`, `staging`, `prod` |

---

## 4. Temuan per Repository

### 4.1 Yang bisa dipakai ulang

| Repo | Aset | Dipakai untuk |
|---|---|---|
| `deeptalk-api-v3` | `ChatTokenService` + `POST /v2/user/book/:id/chat-access` | Pola endpoint `ai/access` |
| `deeptalk-api-v3` | `RedisIoAdapter`, `ChatGateway`, `safe-logger.service.ts`, `metrics.service.ts` | Pola gateway Socket.IO, logging, dan metrik |
| `deeptalk-api-v3` | `UserAuthGuard`, `PsikologAuthGuard`, `PsikologVerifiedGuard` | Melindungi endpoint `ai/access` |
| `deeptalk-api-v3` | `GET /v2/user/find/psikologs`, `/psikolog/:id`, `/psikolog/:id/services` (publik) | Tool rekomendasi psikolog |
| `deeptalk-api-v3` | `GET /v2/user/find/assessments`, `/assessment/free-test` (publik) | Tool rekomendasi asesmen |
| `deeptalk-api-v3` | `NotificationDeliveryService.sendToUsers()` / `sendToPsikolog()` | Pengingat routine dan notifikasi handoff |
| `deeptalk-api-v3` | Pola guard token servis (`LOGOS_CALLBACK_TOKEN`, `PAYMENT_CALLBACK_TOKEN`, `CRON_SECRET`) | `AiServiceTokenGuard` |
| `deeptalk-api-v3` | Plan `user-close-account.md`, modul `admin-user` (merge) | Titik pemicu webhook siklus hidup akun |
| `deeptalk-api-v3` | Konvensi: envelope `{ success, message?, data }`, recap `docs/tasks/`, `openapi.yaml`, migrasi via `migrate diff` + `migrate deploy` | Wajib untuk setiap perubahan di v3 |
| `deeptalk-web-v2` | BFF `/api/v2/[...path]`, `use-chat-session.ts` | Chat AI di web |
| `deeptalk-web-v2` | Halaman asesmen, psikolog, dan booking | Tujuan *deep link* kartu |
| `deeptalk-app-v2` | `socket.io-client`, `expo-secure-store`, `lib/chat.ts`, `lib/push.ts` | Chat AI dan pengingat di mobile |
| `psikolog-deeptalk-dashboard` | Login psikolog, BFF `app/api/deeptalk`, fitur `bookings`/`chat` | Ringkasan handoff, evaluasi, kurasi Persona Card |
| `psikolog-app-v2` | Push psikolog | Notifikasi handoff baru |

### 4.2 Copy yang perlu direvisi (T10)

| File | Isi yang bermasalah |
|---|---|
| `deeptalk-web-v2/src/components/home/approach-section.tsx:16` | "Dilatih khusus untuk memahami konteks kesehatan mental Indonesia" |
| `deeptalk-web-v2/src/components/home/approach-section.tsx:122-125` | "AI yang Dilatih Khusus …" dan "dilatih secara mendalam dengan ribuan data percakapan kesehatan mental" |
| `deeptalk-web-v2/src/components/home/hero-section.tsx:69` | "AI yang dilatih khusus untuk kesehatan mental" |
| `deeptalk-web-v2/src/components/home/home-hero.tsx:127` | Sama dengan di atas |
| `deeptalk-web-v2/src/app/about/page.tsx:92` | "Teman bicara yang dilatih khusus …" |
| `deeptalk-web-v2/docs/copywrite.md:34, 119-122` | Sumber copy di atas, termasuk stat "Teman AI · Siap 24/7" |

Usulan pengganti yang bisa dibuktikan: *"Pendekatannya dirancang bersama psikolog berlisensi DeepTalk"*, *"Dilengkapi lapisan keamanan yang mengarahkan ke bantuan profesional"*.

### 4.3 Yang belum ada dan harus dibangun

- Seluruh layanan `deeptalk-ai`: gateway, agent, database, dan infrastruktur.
- Daily Routine: pustaka, routine pengguna, log harian, UI web/app, dan pengingat.
- Consent layanan dan consent pelatihan AI. v3 belum punya tabel consent.
- Endpoint `ai/access`, JWKS, dan endpoint internal di v3.
- UI Teman AI di web dan app, serta menu Teman AI di dashboard psikolog.
- Workflow kurasi Persona Card dan pengelolaan konten klinis oleh psikolog.

---

## 5. Perubahan dari Dokumen Sumber

| Topik | Dokumen sumber | Rancangan baru |
|---|---|---|
| Konteks | Prototipe kompetisi + roadmap | Produk produksi tanpa tenggat; rilis bertahap dengan gerbang mutu |
| API yang diintegrasikan | `deeptalk-api` di AWS | `deeptalk-api-v3` (Dokploy) |
| Auth pengguna dan psikolog | Validasi JWT langsung | Token exchange, ES256, JWKS dari v3 |
| Client | Web dulu, mobile menyusul | Web dan mobile sama-sama masuk rilis pertama |
| Portal psikolog | App Next.js baru | Fitur di `psikolog-deeptalk-dashboard` |
| Push dan penjadwalan | FCM + Cloud Scheduler di GCP | Cloud Scheduler → gateway → endpoint push internal v3 |
| Skala gateway | Satu instance, Redis opsional | Multi-instance, Redis adapter, timer di BullMQ |
| Knowledge base | RAG Engine | Prompt + context caching, lalu RAG sesuai ambang |
| Safety | Paralel | Safety gate, pengecekan output, risiko lengket, runbook krisis |
| Memori | Stateless | Ringkasan sesi |
| Draft booking dari AI | Ada | Arahkan ke alur booking, lalu tautkan ringkasan ke booking |
| Persona Card | Endpoint draft | Workflow kurasi lengkap di dashboard dengan versi dan audit |
| Konten klinis | Belum diatur | Database sebagai sumber kebenaran, dengan persetujuan dan riwayat versi |
| Lingkungan | `dev`, `demo`, `prod` | `dev`, `staging`, `prod` |
| Struktur repo | `deeptalk-ai-platform/` | `deeptalk-ai/` berisi `gateway/`, `agent/`, `infra/`, `docs/` |

---

## 6. Keputusan yang Masih Perlu Diambil

Melengkapi tabel §13 dokumen konsep (selain butir yang khusus kompetisi).

| # | Pertanyaan | Usulan default | Pemilik | Memblokir |
|---|---|---|---|---|
| Q1 | Persona mana yang menjadi gelombang pertama saat rilis? | 2–4 psikolog yang paling siap materinya | Pak Novri | Phase 2 |
| Q2 | Hosting: tetap di GCP (Vertex AI) sesuai dokumen sumber? | Ya. Alasannya data di Jakarta, Vertex AI terkelola, dan pilot migrasi GCP | Wildan, Pak Novri | Phase 0 |
| Q3 | Strategi peluncuran | Internal → beta psikolog dan pengguna terpilih → persentase → semua | Pak Novri | Phase 7 |
| Q4 | Pengguna di bawah 18 tahun | Diblokir sampai mekanisme wali tersedia | Pak Novri + hukum | Phase 4 |
| Q5 | Konten respons krisis dan tindak lanjut setelah kejadian krisis | Template tetap dari psikolog; kebijakan tindak lanjut diputuskan psikolog dan hukum | Psikolog + hukum | Phase 2 |
| Q6 | Hotline yang dirujuk | Kandidat: layanan SEJIWA 119 ext. 8 dan 112 (perlu diverifikasi) | Psikolog | Phase 2 |
| Q7 | Endpoint model Gemini: regional Jakarta atau global? | **Diputuskan 15 Okt 2026 (Wildan):** `gemini-4-argon` lewat Gemini Enterprise Agent Platform di region `us` untuk semua layanan Gemini; tidak ada endpoint Gemini di Jakarta, dan `global` tidak menjamin lokasi pemrosesan. Pemrosesan AI di AS dibedakan dari penyimpanan: beta di Singapura dan production/rilis resmi di Indonesia. Consent, kebijakan privasi, dan DPIA harus menyebut lokasi per tahap serta transfer pemrosesan ke AS | Wildan | Phase 0 |
| Q8 | Nama fitur di UI | "Teman AI" (sudah dipakai di copy web) | Pak Novri | Phase 2 |
| Q9 | Daily Routine berdiri sendiri, atau terintegrasi dengan SelfTalk? | Berdiri sendiri, dengan tautan dari SelfTalk | Pak Novri | Phase 3 |
| Q10 | Masa retensi percakapan, ringkasan, dan kejadian keamanan | Ditentukan konsultan hukum | Hukum | Phase 4 |
| Q11 | Durasi idle dan tenggang penutupan sesi | Idle 30 menit, tenggang 3 menit | Wildan, Pak Novri | Phase 2 |
| Q12 | Siapa yang memegang on-call untuk insiden keamanan percakapan | Satu engineer + satu psikolog per periode | Pak Novri | Phase 6 |
