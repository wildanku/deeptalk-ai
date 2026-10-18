# DeepTalk AI — Rencana Phase

**Versi:** 8 Oktober 2026 (rev. 2: produk produksi, tanpa timeline) · **Status:** Draft untuk didiskusikan
**Sumber:** [02-implementasi.md](02-implementasi.md) dan dokumen konsep §1–§8
**Tujuan:** checklist dan exit criteria per phase, dari fondasi sampai DeepTalk AI tersedia untuk semua pengguna.

Dokumen ini menentukan **urutan**, **apa yang memblokir apa**, dan **kapan sebuah phase selesai**. Tidak ada tanggal. Sebuah phase selesai ketika exit criteria-nya terpenuhi, bukan ketika waktunya habis. Rancangan teknisnya ada di 02. Bila keduanya bertentangan, perbaiki dokumen ini.

**Legenda status:** ⬜ Belum mulai · 🟦 Berjalan · 🟨 Sebagian · ✅ Selesai · ⛔ Terblokir

### Ringkasan status (2026-10-14)

`[x]` = selesai **dan** terverifikasi. `[ ]` = belum; alasannya ditulis di belakang item. Hampir semua kode sudah dibangun dan teruji lokal (E2E 203 pemeriksaan lulus di 6 skenario). Yang tersisa sebagian besar membutuhkan pihak di luar engineering: GCP, konten dan persetujuan psikolog, hukum, keputusan, dan uji ke v3 yang berjalan.

| Phase                               | Status | Checklist `[x]` | Exit criteria `[x]` | Kode                                     | Penghalang utama                                          |
| ----------------------------------- | ------ | --------------- | ------------------- | ---------------------------------------- | --------------------------------------------------------- |
| 0 Prasyarat & Keputusan             | ⛔     | 1/9             | 1/2                 | Terraform ditulis, copy situs diperbaiki | Keputusan Q1–Q12, GCP, hukum                              |
| 1 Fondasi Platform                  | ⛔     | 12/17           | 0/4                 | Selesai, teruji lokal                    | GCP (KMS, Cloud Run, pipeline), uji client ke v3          |
| 2 Percakapan Inti & Keamanan        | ⛔     | 22/27           | 1/3                 | Selesai, teruji lokal                    | Konten klinis, GCP, uji client                            |
| 3 Output: Routine, Asesmen, Handoff | ⛔     | 10/16           | 2/3                 | Selesai, teruji lokal                    | Konten klinis, Q9, GCP, uji client                        |
| 4 Consent, Privasi & Siklus Data    | ⛔     | 4/9             | 1/3                 | Selesai, teruji lokal                    | Teks hukum + DPIA, Q4, Q10, uji client                    |
| 5 Portal Psikolog & Kurasi Konten   | ⛔     | 6/7             | 2/3                 | Selesai, teruji lokal                    | Uji dengan psikolog nyata, konten                         |
| 6 Hardening Produksi                | ⛔     | 2/8             | 0/3                 | Selesai sejauh tanpa GCP                 | GCP, on-call (Q5/Q12), temuan keamanan repo lain, pentest |
| 7 Peluncuran Bertahap → GA          | ⛔     | 2/4             | 0/2                 | Perangkat peluncuran siap                | Semua di atas + Q3                                        |
| 8 Pengembangan Lanjutan             | ⛔     | 0/7 (sub-item 8/15) | —                   | Kode siap, konten DRAFT                  | Konten psikolog, keputusan Phase 8, Phase 7 GA            |
| 9 Data & Model                      | ⛔     | 0/5             | —                   | Perangkat siap, terkunci                 | Consent pengguna lama, addendum, DPIA, etik, ekstraksi    |

Rincian per blocker: [blockers/README.md](blockers/README.md).

---

## 1. Prinsip Pengerjaan

- **Keamanan adalah gerbang, bukan fitur.** Tidak ada phase setelah Phase 2 yang boleh dirilis ke pengguna bila gerbang evaluasi safety (02 §12.1) gagal.
- **Konten klinis hanya dari psikolog.** Engineering boleh berjalan dengan konten placeholder bertanda `DRAFT`, tetapi konten berstatus selain `approved` tidak pernah aktif di `prod`.
- **Perubahan di repo lain mengikuti konvensi repo tersebut.** v3: `AGENT.md`, recap `docs/tasks/`, `openapi.yaml`. Web: `docs/phase/DEFINITION-OF-DONE.md`. App dan dashboard: `AGENTS.md`.
- **Setiap pekerjaan di repo ini punya recap** di `deeptalk-ai/docs/tasks/YYYYMMDD-<nama-task>.md`, dan setiap blocker punya file di `deeptalk-ai/docs/blockers/<nama-blocker>.md` (lihat `AGENT.md`).
- **Web dan app berjalan bersama.** Setiap fitur pengguna dianggap selesai bila tersedia di keduanya, kecuali disebut lain.

---

## 2. Cakupan

|                                       | Isi                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Rilis pertama (Phase 0–7)**         | Teman AI di web dan app · persona gelombang pertama (Q1) + Quick Chat · safety berlapis + protokol krisis + runbook · kuota dan penutupan sesi · memori lintas sesi · Daily Routine dengan pengingat push · rekomendasi asesmen · handoff dengan ringkasan pra-sesi yang tertaut ke booking · dua consent · hapus/merge akun dan retensi · portal psikolog (handoff, kurasi persona, evaluasi, konten klinis, tinjauan keamanan) · observability, SLO, dan peluncuran bertahap |
| **Pengembangan lanjutan (Phase 8–9)** | Persona untuk seluruh psikolog · topik routine tambahan · daily check-in dan skrining berkala · inventori kepribadian saat onboarding · RAG Engine · ekspansi regional · pemanfaatan data dengan consent dan fine-tuning                                                                                                                                                                                                                                                       |

---

## 3. Urutan dan Dependensi

```text
Phase 0 Prasyarat & Keputusan
  → Phase 1 Fondasi Platform
  → Phase 2 Percakapan Inti & Keamanan
      ├─→ Phase 3 Output: Routine, Asesmen, Handoff
      ├─→ Phase 4 Consent, Privasi & Siklus Data
      └─→ Phase 5 Portal Psikolog & Kurasi Konten
  → Phase 6 Hardening Produksi        (butuh 3, 4, 5 selesai)
  → Phase 7 Peluncuran Bertahap → GA
  → Phase 8 Pengembangan Lanjutan
  → Phase 9 Data & Model
```

Phase 3, 4, dan 5 bisa dikerjakan paralel setelah Phase 2. Phase 5 bagian "Persona saya" sebaiknya dimulai lebih awal, karena psikolog gelombang pertama membutuhkannya untuk menyetujui Persona Card.

---

## 4. Jalur Paralel: Konten Klinis dari Psikolog

Berjalan sejak Phase 0. Kolom "Memblokir" menunjukkan phase yang tidak bisa **dinyatakan selesai** tanpa konten tersebut.

| Konten                                                       | Memblokir                              | Pemilik             |
| ------------------------------------------------------------ | -------------------------------------- | ------------------- |
| Keputusan persona gelombang pertama (Q1)                     | Phase 2                                | Pak Novri           |
| Definisi level risiko + protokol krisis + hotline (Q5, Q6)   | Phase 2                                | Psikolog            |
| Kebijakan tindak lanjut kejadian krisis (Q5)                 | Phase 6                                | Psikolog + hukum    |
| Daftar frasa krisis bahasa Indonesia (L1)                    | Phase 2                                | Psikolog + engineer |
| Kuesioner pendekatan + 20–30 jawaban studi kasus per persona | Phase 2 (draft), Phase 5 (persetujuan) | Psikolog persona    |
| Studi kasus evaluasi (terpisah dari few-shot)                | Phase 6                                | Psikolog            |
| Materi pengetahuan klinis per topik                          | Phase 2                                | Psikolog            |
| Pustaka routine (topik awal: stres kerja, mengurangi rokok)  | Phase 3                                | Psikolog            |
| Pemetaan topik ke asesmen                                    | Phase 3                                | Psikolog            |
| Daftar psikolog yang menerima handoff                        | Phase 3                                | Pak Novri           |
| Persetujuan Persona Card + penilaian evaluasi                | Phase 7                                | Psikolog persona    |

---

## Phase 0 — Prasyarat & Keputusan ⛔

**Outcome:** keputusan yang memblokir sudah diambil, fondasi cloud dan kepatuhan sudah disiapkan, dan copy yang keliru sudah diperbaiki.

> **Status 2026-10-14:** hampir semua item butuh keputusan, akun, atau pihak di luar engineering. Yang sudah dikerjakan engineering: kode Terraform ketiga lingkungan dan perbaikan copy situs (Phase 7).

### Checklist

- [ ] Keputusan Q1–Q12 di [01-review](01-review-dokumen-dan-codebase.md) §6 diambil atau dijadwalkan dengan pemiliknya (minimal Q1, Q2, Q7) — belum; yang memblokir dicatat di [register blocker](blockers/README.md) (Q3, Q4, Q5/Q12, Q9, Q10, konten Q1)
- [ ] Proyek GCP `dev`/`staging`/`prod` terpisah: billing, region `asia-southeast2`, Vertex AI, Cloud Run, Cloud Tasks, Cloud Scheduler, VM GCE + Dokploy (Postgres AI, Redis, web, v3, psikolog-service), Secret Manager, KMS, Artifact Registry ([topologi 2026-10-15](../../docs/deeptalk-ai/topologi-deployment-151026.md)) — terblokir: [lingkungan-gcp-dev](blockers/lingkungan-gcp-dev.md)
- [ ] Infrastruktur sebagai kode (`infra/`) untuk ketiga lingkungan — kode ditulis (`infra/envs/{dev,staging,prod}`, `infra/modules/*`); belum pernah `plan`/`apply` ([lingkungan-gcp-dev](blockers/lingkungan-gcp-dev.md), [tooling-lokal-terraform-docker](blockers/tooling-lokal-terraform-docker.md))
- [ ] Verifikasi model Gemini dan endpoint regional (Q7); catat hasilnya di 02 §13 — diputuskan 15 Okt: `gemini-4-argon` di `us` (Jakarta tidak punya endpoint Gemini); agent sudah disesuaikan. Uji dari Cloud Run belum ([lingkungan-gcp-dev](blockers/lingkungan-gcp-dev.md)). 15 Okt: Argon `us` terpanggil dari proyek trial `deeptalk-496008` (laptop, `evals.smoke_model` lulus); L2 lebih lambat dari `SAFETY_TIMEOUT_MS` default — [latensi-l2-argon](blockers/latensi-l2-argon.md)
- [ ] Verifikasi ketentuan penggunaan data Vertex AI — belum; butuh akun GCP dan tinjauan hukum
- [ ] Konfirmasi host Dokploy v3 dan jalur jaringan ke GCP — diputuskan 15 Okt: VM GCE di proyek dan VPC yang sama, gateway lewat IP internal (Direct VPC egress); VM belum dibuat; terkait [uji-client-ke-v3-dev](blockers/uji-client-ke-v3-dev.md)
- [ ] Penunjukan konsultan hukum UU PDP; mulai DPIA — terblokir: [teks-hukum-consent-privasi-dpia](blockers/teks-hukum-consent-privasi-dpia.md)
- [x] Revisi copy "dilatih ribuan data" di `deeptalk-web-v2` (01 §4.2) — dikerjakan di Phase 7 (beranda, hero, /about, `docs/copywrite.md`); belum dirilis, persetujuan copy: [keputusan-q3-peluncuran](blockers/keputusan-q3-peluncuran.md)
- [ ] Brief ke psikolog: tabel konten §4 — daftar konten ada (§4, [konten-klinis-gelombang-pertama](blockers/konten-klinis-gelombang-pertama.md)); brief-nya sendiri belum tercatat dilakukan

### Exit criteria

- [ ] Gemini bisa dipanggil dari ketiga proyek GCP dengan model yang dipilih — terblokir: [lingkungan-gcp-dev](blockers/lingkungan-gcp-dev.md)
- [x] Copy situs tidak lagi memuat klaim yang tidak bisa dibuktikan — diperiksa 2026-10-14: tidak ada lagi "dilatih", "ribuan data", "100% privat" di `src/` web (cabang `feat/ai-phase-1`, belum dirilis)

---

## Phase 1 — Fondasi Platform ⛔

**Outcome:** pengguna dan psikolog di `dev` bisa mendapat token AI dari v3, terhubung ke gateway multi-instance, dan menerima balasan streaming dari agent. Belum ada persona atau safety.

Status per 2026-10-08: kode selesai dan teruji lokal; penyelesaian di `dev` terblokir oleh Phase 0 ([lingkungan-gcp-dev](blockers/lingkungan-gcp-dev.md)). Recap: [20261008-phase-1-fondasi-platform](tasks/20261008-phase-1-fondasi-platform.md).

### Checklist — `deeptalk-api-v3`

- [x] Kunci ES256, `GET /v2/.well-known/ai-jwks.json`, prosedur rotasi `kid` (`docs/guidance/ai-token-exchange.md` di v3)
- [x] `POST /v2/user/ai/access`, `POST /v2/psikolog/ai/access`, `GET /v2/user/ai/availability` (02 §5.1–§5.2)
- [x] Kontrol rollout: `AI_ROLLOUT_MODE`, `AI_ALLOWED_USER_IDS`, `AI_ROLLOUT_PERCENT`
- [x] `AiServiceTokenGuard` + `GET /v2/internal/ai/users/:userId`
- [x] Env di `src/config/env.schema.ts` dan `.env.example`; unit test; `openapi.yaml`; recap (`docs/tasks/20261008-ai-token-exchange.md` di v3)

### Checklist — `deeptalk-ai/gateway`

- [x] Scaffold NestJS 11 + Prisma + zod config; envelope respons seperti v3 ([recap](tasks/20261008-skeleton-awal.md))
- [x] Skema Postgres AI inti (`ai_user_state`, `ai_sessions`, `ai_messages`, `ai_outbox`, `ai_inbound_events`) — migrasi `init` dibuat dan diterapkan ke Postgres lokal; belum ke Postgres AI di VM
- [x] Verifikasi token lewat JWKS (REST + handshake socket + `auth.refresh`)
- [x] Namespace `/ai` dengan Redis adapter; uji fan-out dua instance (lokal)
- [x] `message.send` → simpan (idempoten) → agent → relay `ai.token`/`ai.done`
- [ ] Enkripsi isi pesan dengan KMS — AES-256-GCM + envelope KMS selesai dan diuji dengan KMS tiruan dan kunci lokal; Cloud KMS asli belum (terblokir)
- [x] Logging aman, metrik dasar, dan tracing — logging aman dan metrik berbasis log (Phase 1); tracing OpenTelemetry dengan sanitasi atribut di gateway dan agent (Phase 6); ekspor ke Cloud Trace belum aktif ([lingkungan-gcp-dev](blockers/lingkungan-gcp-dev.md))

### Checklist — `deeptalk-ai/agent`

- [x] Scaffold Python + ADK + FastAPI; `POST /v1/turn` SSE dengan aturan global — aturan global masih `DRAFT`; diuji dengan model lokal, Gemini belum (terblokir)
- [ ] Cloud Run privat; gateway memanggil dengan ID token — kode klien ID token ada; belum pernah berjalan (terblokir)

### Checklist — CI/CD dan client

- [ ] Pipeline Cloud Build: lint, test, migrate deploy, deploy dengan traffic split — `cloudbuild/` ditulis, belum pernah dijalankan (terblokir)
- [ ] Web: `use-ai-session.ts` + layar chat minimal di balik `availability` — dibangun; belum diuji ke v3 yang berjalan ([uji-client-ke-v3-dev](blockers/uji-client-ke-v3-dev.md))
- [ ] App: hook sesi AI + layar chat minimal di balik `availability` — dibangun dan ter-bundle; belum dijalankan di perangkat ([uji-client-ke-v3-dev](blockers/uji-client-ke-v3-dev.md))

### Exit criteria

- [ ] Satu percakapan dari web **dan** app ke Gemini lalu kembali, di `dev`, dengan dua instance gateway — lokal: lulus dengan model lokal dan dua instance (`gateway/scripts/smoke-chat.mjs`), tanpa UI
- [ ] Token ditolak bila `aud` salah, kedaluwarsa, `kid` tidak dikenal, atau pengguna di luar rollout — lokal: lulus (gateway + unit test v3); belum di `dev`
- [ ] Deploy gateway saat ada sesi berjalan → client reconnect dan melanjutkan tanpa kehilangan pesan — lokal: lulus dengan SIGTERM di tengah giliran; belum dengan deploy Cloud Run
- [ ] Log, trace, dan pesan error tidak memuat isi percakapan (diperiksa) — lokal: log gateway/agent dan DB diperiksa bersih, span trace disanitasi dan diuji (Phase 6); belum diperiksa di `dev`

---

## Phase 2 — Percakapan Inti & Keamanan ⛔

**Terblokir oleh:** protokol krisis, definisi level risiko, frasa L1, dan draft Persona Card gelombang pertama (§4).

**Outcome:** pengguna memilih persona atau Quick Chat, berbicara dengan persona yang berbeda gayanya, dan setiap sinyal krisis dialihkan ke protokol. Sesi dibatasi kuota dan waktu aktif, dan AI mengingat sesi sebelumnya.

> **Status 2026-10-10:** kode selesai dan teruji lokal dengan konten `DRAFT` dan model lokal ([recap](tasks/20261010-phase-2-3-percakapan-keamanan-output.md)). Tertahan konten klinis ([konten-klinis-gelombang-pertama](blockers/konten-klinis-gelombang-pertama.md)), GCP ([lingkungan-gcp-dev](blockers/lingkungan-gcp-dev.md)), dan uji client ([uji-client-ke-v3-dev](blockers/uji-client-ke-v3-dev.md)).

### Checklist — Persona dan percakapan

- [x] Model konten berversi (`ai_content_versions`, `ai_personas`); seed dari `content/` (`pnpm run content:seed`, append-only)
- [x] Persona Card `approved` dimuat ke prompt (02 §7.3); di `dev`, versi draft boleh dipakai (`CONTENT_ALLOW_DRAFT`, ditolak di production) — Persona Card asli belum ada: [konten-klinis-gelombang-pertama](blockers/konten-klinis-gelombang-pertama.md)
- [ ] Pengetahuan klinis per topik + context caching — pemuatan per topik selesai; materi asli terblokir ([konten-klinis-gelombang-pertama](blockers/konten-klinis-gelombang-pertama.md)); Argon hanya mendukung implicit caching (explicit caching dimatikan, `CONTEXT_CACHE=off`); hit cache belum terverifikasi ([lingkungan-gcp-dev](blockers/lingkungan-gcp-dev.md))
- [x] Router Quick Chat dengan alasan yang ditampilkan ke pengguna
- [x] Ganti persona di tengah sesi; `persona.unavailable` saat persona dinonaktifkan
- [x] Memori lintas sesi (ringkasan sesi via outbox, terenkripsi) + pengaturan memori

### Checklist — Keamanan

- [x] L1 deterministik di gateway (frasa sebagai konten berversi) — mesin selesai; frasa masih `DRAFT`: [konten-klinis-gelombang-pertama](blockers/konten-klinis-gelombang-pertama.md)
- [x] L2 klasifikasi + safety gate; timeout → `elevated` — diuji dengan model lokal; latensi `gemini-4-argon` (thinking `LOW`) belum diukur ([lingkungan-gcp-dev](blockers/lingkungan-gcp-dev.md))
- [x] L3 pengecekan output + template pengganti
- [x] Risiko lengket per sesi; `ai_safety_events`
- [ ] Protokol krisis berversi; `safety.escalation`; UI krisis di web dan app — dibangun; isi protokol `DRAFT` ([konten-klinis-gelombang-pertama](blockers/konten-klinis-gelombang-pertama.md)), UI belum diuji ke v3 ([uji-client-ke-v3-dev](blockers/uji-client-ke-v3-dev.md))
- [ ] Layar bantuan: web publik tanpa login, app tersedia offline — web `/teman-ai/bantuan` diverifikasi dengan `next dev`; app offline belum diuji di perangkat ([uji-client-ke-v3-dev](blockers/uji-client-ke-v3-dev.md))
- [x] Perilaku gagal tertutup saat agent atau Vertex AI tidak tersedia (agent dimatikan → `AGENT_UNAVAILABLE` + info bantuan; krisis tetap lewat L1)
- [x] Alert internal untuk setiap kejadian `crisis` (log `CRITICAL` tanpa isi + webhook opsional) — kanal on-call: Phase 6

### Checklist — Sesi dan kuota

- [x] Kuota bulanan dengan penguncian baris; sesi krisis tidak dihitung
- [x] Waktu aktif, `session.warning`, `wrap_up`, tenggang, idle, dan wall-clock sebagai task tertunda (BullMQ, dimigrasi ke Cloud Tasks 2026-10-15 — [recap](tasks/20261015-topologi-deployment-cloud-tasks.md))
- [x] Kuota habis: safety tetap jalan dulu, baru `quota.exhausted`
- [x] Satu sesi aktif per pengguna; perangkat kedua bergabung ke sesi yang sama
- [x] Rate limit per pengguna dan batas panjang pesan (pesan krisis dikecualikan dari rate limit)
- [ ] UI: label "AI" selalu terlihat, nama "DeepTalk AI dengan pendekatan …", sisa kuota — dibangun di web dan app; belum diuji ke v3 ([uji-client-ke-v3-dev](blockers/uji-client-ke-v3-dev.md))

### Test checklist

- [ ] Semua studi kasus `crisis` memicu eskalasi (L1 atau L2) — lulus pada studi kasus sintetis `DRAFT` (8/8); set final dari psikolog belum ada ([konten-klinis-gelombang-pertama](blockers/konten-klinis-gelombang-pertama.md))
- [x] Respons persona tidak pernah tampil di client untuk giliran yang divonis `crisis` (lokal, E2E)
- [x] Dua perangkat memulai sesi ke-10 bersamaan → hanya satu yang berhasil (lokal, E2E)
- [x] Pesan krisis saat kuota habis → protokol krisis, bukan pesan kuota (lokal, E2E)
- [x] Agent dimatikan → pesan krisis tetap mendapat protokol lewat L1 (lokal, E2E)
- [x] Respons yang menyebut obat atau diagnosis diganti template
- [x] Restart semua instance gateway di tengah sesi → timer sesi tetap benar (lokal, E2E)

### Exit criteria

- [ ] Gerbang evaluasi safety lulus di pipeline — gerbang ada di `cloudbuild/promote.yaml` dan lulus lokal; pipeline belum pernah berjalan ([lingkungan-gcp-dev](blockers/lingkungan-gcp-dev.md)), set kasus final belum ada ([konten-klinis-gelombang-pertama](blockers/konten-klinis-gelombang-pertama.md))
- [ ] Persona gelombang pertama dinilai berbeda gayanya oleh psikolog pemiliknya (uji internal) — terblokir: [konten-klinis-gelombang-pertama](blockers/konten-klinis-gelombang-pertama.md)
- [x] Tidak ada jalur di mana pengguna berisiko menerima pesan "kuota habis" (L1 + L2 sebelum `quota.exhausted`; L2 tidak tersedia → `elevated` + bantuan; diuji lokal)

---

## Phase 3 — Output: Routine, Asesmen, Handoff ⛔

**Terblokir oleh:** pustaka routine, pemetaan asesmen, dan daftar psikolog handoff (§4).

**Outcome:** dari satu percakapan, pengguna bisa menerima routine dengan pengingat, rekomendasi asesmen, dan handoff ke psikolog. Ringkasan yang ia setujui sampai ke psikolog yang menangani booking-nya.

> **Status 2026-10-10:** kode selesai di gateway, agent, v3, web, dan app; diuji lokal dengan v3 tiruan ([recap](tasks/20261010-phase-2-3-percakapan-keamanan-output.md)). Tertahan pustaka routine/pemetaan/daftar psikolog ([konten-klinis-gelombang-pertama](blockers/konten-klinis-gelombang-pertama.md)), Q9 ([keputusan-q9-routine-selftalk](blockers/keputusan-q9-routine-selftalk.md)), uji client ([uji-client-ke-v3-dev](blockers/uji-client-ke-v3-dev.md)), dan UI psikolog (Phase 5).

### Checklist — Daily Routine

- [x] Agent mengusulkan routine hanya dari pustaka versi aktif; gateway memvalidasi (02 §7.4) — pustaka masih `DRAFT`: [konten-klinis-gelombang-pertama](blockers/konten-klinis-gelombang-pertama.md)
- [x] Kartu routine: terima, ubah, atau tolak; tidak ditawarkan saat `elevated`/`crisis` atau untuk topik yang dikecualikan
- [ ] Layar Rutinitas di web dan app: checklist harian, riwayat, pesan suportif untuk hari yang terlewat; tidak memakai kuota — dibangun; API diuji lokal; UI belum diuji ke v3 ([uji-client-ke-v3-dev](blockers/uji-client-ke-v3-dev.md))
- [ ] Pengingat: Cloud Scheduler → gateway → `POST /v2/internal/ai/notifications` (endpoint baru di v3) → push generik — gateway dan v3 selesai, diuji lokal; job Cloud Scheduler dan push FCM nyata belum ([lingkungan-gcp-dev](blockers/lingkungan-gcp-dev.md), [uji-client-ke-v3-dev](blockers/uji-client-ke-v3-dev.md))
- [x] Rangkuman pola mingguan dan tawaran penyesuaian routine
- [ ] Keputusan Q9 (hubungan dengan SelfTalk) diterapkan — default "berdiri sendiri" diterapkan; keputusan belum diambil ([keputusan-q9-routine-selftalk](blockers/keputusan-q9-routine-selftalk.md))

### Checklist — Asesmen

- [x] Tool katalog: `GET /v2/user/find/assessments` ∩ `ai_assessment_mappings` — pemetaan masih kosong: [konten-klinis-gelombang-pertama](blockers/konten-klinis-gelombang-pertama.md)
- [ ] Kartu asesmen dengan alasan dan deep link (web dan app) — dibangun; belum diuji ke v3 ([uji-client-ke-v3-dev](blockers/uji-client-ke-v3-dev.md))
- [x] `GET /v2/internal/ai/users/:userId/assessments` (endpoint baru di v3) untuk konteks percakapan dan ringkasan handoff; AI menjelaskan hasil tanpa menghitung skor

### Checklist — Handoff

- [x] Tool direktori psikolog: `GET /v2/user/find/psikologs` ∩ `ai_handoff_psikologs` — daftar masih kosong: [konten-klinis-gelombang-pertama](blockers/konten-klinis-gelombang-pertama.md)
- [x] Draft ringkasan (tier dokumen); pengguna bisa menghapus bagian; `handoff.decision` — model asli belum dipanggil ([lingkungan-gcp-dev](blockers/lingkungan-gcp-dev.md))
- [ ] Kartu psikolog dengan deep link + parameter `ai_handoff` — dibangun; belum diuji ke v3 ([uji-client-ke-v3-dev](blockers/uji-client-ke-v3-dev.md))
- [x] Alur tautan ke booking (02 §5.5), termasuk `GET /v2/internal/ai/bookings/:id` di v3
- [x] Konfirmasi ulang bila pengguna memesan psikolog lain
- [ ] Notifikasi ke psikolog (dashboard dan `psikolog-app-v2`) — push lewat v3 selesai; daftar handoff di dashboard dan push + layar ringkasan di psikolog-app dibangun di Phase 5; belum diuji di perangkat ([uji-client-ke-v3-dev](blockers/uji-client-ke-v3-dev.md))
- [x] `GET /v2/psikolog/book/:bookingId/ai-summary` di v3

### Exit criteria

- [ ] Alur Rani (dokumen konsep §5) berjalan dari awal sampai akhir di `staging`, di web dan app — lokal lulus tanpa UI (`e2e/`); terblokir: [lingkungan-gcp-dev](blockers/lingkungan-gcp-dev.md), [uji-client-ke-v3-dev](blockers/uji-client-ke-v3-dev.md), [konten-klinis-gelombang-pertama](blockers/konten-klinis-gelombang-pertama.md)
- [x] Output terstruktur dengan ID palsu tidak pernah lolos validasi (diuji)
- [x] Psikolog yang tidak ditugaskan di sebuah booking tidak bisa membaca ringkasannya (diuji)

---

## Phase 4 — Consent, Privasi & Siklus Data ⛔

**Terblokir oleh:** teks consent yang ditinjau hukum, keputusan Q4 (usia) dan Q10 (retensi).

**Outcome:** semua kewajiban data pengguna terpenuhi: consent berversi, gerbang usia, hapus/merge akun, hapus riwayat, dan retensi.

> **Status 2026-10-11:** mekanisme selesai dan teruji lokal ([recap](tasks/20261010-phase-4-5-consent-data-portal-psikolog.md)). Tertahan teks hukum ([teks-hukum-consent-privasi-dpia](blockers/teks-hukum-consent-privasi-dpia.md)), Q4 ([keputusan-q4-usia](blockers/keputusan-q4-usia.md)), Q10 ([keputusan-q10-retensi](blockers/keputusan-q10-retensi.md)), dan uji client ([uji-client-ke-v3-dev](blockers/uji-client-ke-v3-dev.md)).

### Checklist

- [x] Consent layanan wajib sebelum pesan pertama, dengan `text_version` — teks masih DRAFT: [teks-hukum-consent-privasi-dpia](blockers/teks-hukum-consent-privasi-dpia.md)
- [x] Consent pelatihan AI: waktu tampil sesuai 02 §9.2, tombol setara, bisa dicabut (UI belum diuji ke v3: [uji-client-ke-v3-dev](blockers/uji-client-ke-v3-dev.md))
- [x] Persetujuan ulang saat teks consent berubah secara material (`min_accepted_version`)
- [ ] Gerbang usia: minta tanggal lahir bila `birth_date` kosong; terapkan keputusan Q4 — dibangun dengan usulan Q4 (`AI_MIN_AGE=18`); keputusan: [keputusan-q4-usia](blockers/keputusan-q4-usia.md)
- [x] Webhook hapus akun dan merge akun dari v3 (lewat outbox) + handler idempoten di gateway — outbox = `deleted_data` v3 yang ditarik berkala; webhook = jalur cepat
- [ ] `DELETE /v1/me/history`; pengaturan memori; layar "Persetujuan & data" di web dan app — API diuji E2E; layar dibangun, belum diuji ke v3 ([uji-client-ke-v3-dev](blockers/uji-client-ke-v3-dev.md))
- [ ] Job retensi sesuai Q10 — job harian ada; periode kosong sampai [keputusan-q10-retensi](blockers/keputusan-q10-retensi.md)
- [ ] Kebijakan privasi web/app diperbarui (penyedia model, lokasi pemrosesan, hak pengguna) — terblokir: [teks-hukum-consent-privasi-dpia](blockers/teks-hukum-consent-privasi-dpia.md)
- [ ] DPIA selesai — terblokir: [teks-hukum-consent-privasi-dpia](blockers/teks-hukum-consent-privasi-dpia.md)

### Exit criteria

- [ ] Hapus akun di v3 → tidak ada data pengguna tersisa di Postgres AI selain yang diwajibkan retensi (diuji end-to-end) — lulus lokal dengan v3 tiruan (webhook dan feed tarik); belum dengan v3 sungguhan ([uji-client-ke-v3-dev](blockers/uji-client-ke-v3-dev.md))
- [x] Merge akun → riwayat, routine, dan kuota pindah dengan benar (diuji: E2E lokal)
- [ ] Teks consent dan kebijakan privasi disetujui konsultan hukum — terblokir: [teks-hukum-consent-privasi-dpia](blockers/teks-hukum-consent-privasi-dpia.md)

---

## Phase 5 — Portal Psikolog & Kurasi Konten ⛔

**Outcome:** psikolog mengelola persona dan konten klinisnya sendiri, membaca ringkasan handoff, menilai respons AI, dan meninjau kejadian keamanan, tanpa bantuan engineer.

> **Status 2026-10-11:** gateway, agent, dashboard, dan psikolog-app selesai; API diuji E2E lokal, BFF dashboard diuji dengan v3 tiruan ([recap](tasks/20261010-phase-4-5-consent-data-portal-psikolog.md)). Tertahan uji dengan login psikolog nyata ([uji-client-ke-v3-dev](blockers/uji-client-ke-v3-dev.md)), Gemini ([lingkungan-gcp-dev](blockers/lingkungan-gcp-dev.md)), dan konten dari psikolog ([konten-klinis-gelombang-pertama](blockers/konten-klinis-gelombang-pertama.md)).

### Checklist — `psikolog-deeptalk-dashboard`

- [x] Token AI psikolog lewat BFF; peran `psikolog` dan `clinical_reviewer` di gateway (BFF diuji dengan v3 tiruan)
- [x] **Persona saya:** kuesioner → studi kasus → draft Persona Card (`POST /v1/persona/draft`) → koreksi → persetujuan; tombol nonaktifkan yang langsung berlaku — API diuji E2E; kuesioner dan studi kasus masih DRAFT ([konten-klinis-gelombang-pertama](blockers/konten-klinis-gelombang-pertama.md))
- [x] **Handoff:** daftar dan detail ringkasan; status `viewed`
- [x] **Evaluasi:** respons per studi kasus (aman, sesuai gaya, catatan); hasil tertaut ke versi persona — model lokal; Gemini belum ([lingkungan-gcp-dev](blockers/lingkungan-gcp-dev.md))
- [x] **Konten klinis:** alur draft → in_review → approved untuk protokol, pustaka routine, frasa L1, pemetaan asesmen, materi pengetahuan; riwayat versi dan siapa menyetujui (+ teks consent, kuesioner, studi kasus; penyetuju ≠ penulis)
- [x] **Tinjauan keamanan:** daftar `ai_safety_events` dan catatan tinjauan

### Checklist — `psikolog-app-v2`

- [ ] Notifikasi handoff baru dan tampilan ringkasan — dibangun dan ter-bundle; belum diuji di perangkat dengan push nyata ([uji-client-ke-v3-dev](blockers/uji-client-ke-v3-dev.md))

### Exit criteria

- [ ] Satu psikolog menyelesaikan kurasi personanya dari kuesioner sampai `approved` tanpa bantuan engineer — alur API lulus E2E; butuh psikolog sungguhan di dashboard ([uji-client-ke-v3-dev](blockers/uji-client-ke-v3-dev.md), [konten-klinis-gelombang-pertama](blockers/konten-klinis-gelombang-pertama.md))
- [x] Menonaktifkan persona menghentikannya di sesi berjalan dalam satu giliran (diuji: E2E lokal)
- [x] Setiap konten aktif di `prod` punya `approved_by` dan `approved_at` (CHECK constraint di database; diuji)

---

## Phase 6 — Hardening Produksi ⛔

**Terblokir oleh:** Phase 3, 4, 5 selesai; kebijakan tindak lanjut krisis (Q5); penunjukan on-call (Q12).

**Outcome:** layanan siap menerima pengguna nyata: terukur, teruji beban, aman, dan punya prosedur untuk setiap insiden.

> **Status 2026-10-11:** semua yang bisa dikerjakan tanpa GCP selesai: metrik SLO, tracing, modul monitoring (kode), runbook, uji beban lokal, tinjauan keamanan internal + perbaikan, gerbang persona di pipeline, laporan respons AI ([recap](tasks/20261011-phase-6-hardening-produksi.md)). Tertahan GCP ([lingkungan-gcp-dev](blockers/lingkungan-gcp-dev.md)), on-call/Q5 ([keputusan-q5-q12-oncall-krisis](blockers/keputusan-q5-q12-oncall-krisis.md)), dan uji penetrasi eksternal.

### Checklist

- [ ] SLO dan dashboard (02 §12.2); alert ke kanal on-call — metrik, tracing, dan modul `infra/modules/monitoring` selesai ([slo.md](slo.md)); belum di-apply ([lingkungan-gcp-dev](blockers/lingkungan-gcp-dev.md)), kanal on-call ([keputusan-q5-q12-oncall-krisis](blockers/keputusan-q5-q12-oncall-krisis.md))
- [ ] Runbook: insiden krisis, gangguan Vertex AI, respons tidak aman, kebocoran data (02 §12.4); latihan simulasi minimal satu kali per runbook — runbook ditulis ([runbooks/](runbooks/README.md)), simulasi teknis lokal lewat E2E; latihan dengan orang terblokir: [keputusan-q5-q12-oncall-krisis](blockers/keputusan-q5-q12-oncall-krisis.md)
- [ ] Uji beban sesuai target tahap rollout pertama — `e2e/load.mjs`; baseline lokal 100 pengguna lulus SLO; `staging` dengan Gemini terblokir: [lingkungan-gcp-dev](blockers/lingkungan-gcp-dev.md) (target: Q3)
- [ ] Tinjauan keamanan dan uji penetrasi gateway; temuan kritis diperbaiki — tinjauan internal selesai, temuan di layanan AI diperbaiki; temuan dependensi di repo lain ditangani pemilik masing-masing repo (dicatat internal, tidak dipublikasikan); uji penetrasi eksternal belum
- [ ] Uji restore backup Postgres AI — prosedur di [runbook](runbooks/restore-postgres-ai.md); uji terblokir: [lingkungan-gcp-dev](blockers/lingkungan-gcp-dev.md)
- [x] Kontrol biaya: batas token, metrik biaya per sesi, alert anggaran (token per giliran/sesi, `google_billing_budget`; alert belum di-apply)
- [x] Gerbang evaluasi safety dan evaluasi persona aktif di pipeline promosi `prod` (`eval-gate` + `persona-gate` di `cloudbuild/promote.yaml`; pipeline belum pernah berjalan)
- [ ] Kebijakan toko aplikasi untuk fitur AI terkait kesehatan ditinjau; app siap rilis — ditinjau ([dokumen](rilis/kebijakan-toko-aplikasi.md)), "Laporkan respons" dibangun; teks consent harus menyebut penyedia AI ([teks-hukum-consent-privasi-dpia](blockers/teks-hukum-consent-privasi-dpia.md))

### Exit criteria

- [ ] Semua SLO terpenuhi di `staging` selama uji beban — terblokir: [lingkungan-gcp-dev](blockers/lingkungan-gcp-dev.md)
- [ ] Tidak ada temuan keamanan kritis atau tinggi yang terbuka — layanan AI bersih; repo lain ditangani pemilik masing-masing repo (dicatat internal)
- [ ] On-call engineer dan psikolog sudah ditunjuk dan sudah berlatih runbook krisis — terblokir: [keputusan-q5-q12-oncall-krisis](blockers/keputusan-q5-q12-oncall-krisis.md)

---

## Phase 7 — Peluncuran Bertahap → GA ⛔

**Outcome:** DeepTalk AI tersedia untuk semua pengguna, dengan setiap tahap dibuka berdasarkan data, bukan tanggal.

> **Status 2026-10-14:** perangkat peluncuran siap: pintu masuk beranda, indikator dampak, playbook + `rollout:readiness`, materi komunikasi, copy situs diperbaiki ([recap](tasks/20261014-phase-7-peluncuran-bertahap.md)). Tahap 7.1 belum bisa dibuka: semua blocker phase sebelumnya + [keputusan-q3-peluncuran](blockers/keputusan-q3-peluncuran.md).

| Tahap             | Siapa                                                | Syarat naik ke tahap berikutnya                                                              |
| ----------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 7.1 Internal      | Tim DeepTalk + psikolog (`allowlist`)                | Tidak ada insiden safety terbuka; umpan balik psikolog ditindaklanjuti                       |
| 7.2 Beta tertutup | Pengguna terpilih yang mendaftar (`allowlist`)       | SLO terpenuhi; tinjauan sampel percakapan (dengan consent) oleh psikolog tanpa temuan kritis |
| 7.3 Bertahap      | `percentage` naik bertahap (misalnya 5% → 25% → 50%) | SLO dan biaya per sesi stabil di setiap kenaikan; uji beban untuk tahap berikutnya lulus     |
| 7.4 GA            | `all`                                                | Keputusan bersama Pak Novri dan Wildan                                                       |

### Checklist

- [ ] Materi komunikasi peluncuran dengan klaim yang bisa dibuktikan (prinsip "Jujur dalam klaim") — draf + daftar klaim ([materi](rilis/materi-komunikasi.md)), klaim palsu di web dihapus; menunggu persetujuan ([keputusan-q3-peluncuran](blockers/keputusan-q3-peluncuran.md))
- [x] Pintu masuk Teman AI di beranda web dan app (tampil hanya bila akun ada di rollout; belum diuji ke v3: [uji-client-ke-v3-dev](blockers/uji-client-ke-v3-dev.md))
- [x] Indikator dampak dari dokumen konsep §8 tersedia di dashboard: routine dibuat dan kepatuhannya, rujukan ke asesmen dan psikolog, penilaian keamanan oleh psikolog (`GET /v1/review/impact`, halaman Dampak; diuji E2E)
- [ ] Tinjauan pasca-peluncuran setelah setiap tahap — [template](rilis/tinjauan-pasca-tahap-template.md) dan [playbook](rilis/peluncuran-bertahap.md) siap; tahap belum dibuka

### Exit criteria

- [ ] `AI_ROLLOUT_MODE = all`
- [ ] Dua siklus kuota bulanan penuh berjalan di GA tanpa insiden safety terbuka

---

## Phase 8 — Pengembangan Lanjutan ⛔

Setiap item melalui gerbang yang sama: konten disetujui psikolog dan evaluasi lulus.

> **Status 2026-10-14:** sisi kode siap dan teruji lokal dengan konten `DRAFT` ([recap](tasks/20261014-phase-8-pengembangan-lanjutan.md)): router Quick Chat untuk banyak persona, kind `topic` + halaman Cakupan, cek diri (check-in, skrining, inventori) di web/app, pemantau ambang RAG, audit ekspansi. Tidak ada yang aktif di `prod` sebelum konten disetujui dan keputusan [keputusan-phase-8-lanjutan](blockers/keputusan-phase-8-lanjutan.md) diambil. Phase 7 juga belum GA.

Item utama baru dicentang bila semua sub-itemnya selesai. Sub-item `[x]` = bagian yang sudah dikerjakan dan teruji lokal.

- [ ] Persona untuk seluruh psikolog yang bersedia, lewat workflow Phase 5
  - [x] Router Quick Chat untuk banyak persona: maks. 12 kandidat, yang paling jarang dipakai didahulukan, bergilir per topik (unit test)
  - [x] Filter topik dan label "Fokus" di pemilih persona web/app; progres persona di dashboard Cakupan
  - [ ] Persona disusun dan disetujui oleh tiap psikolog — menunggu psikolog ([konten-klinis-gelombang-pertama](blockers/konten-klinis-gelombang-pertama.md))
- [ ] Topik routine tambahan
  - [x] Kind konten `topic`, `GET /v1/review/coverage`, halaman Cakupan di dashboard, placeholder DRAFT `tidur`/`kecemasan` (E2E)
  - [ ] Topik dan isi routine/pengetahuan/pemetaan disetujui psikolog — [keputusan-phase-8-lanjutan](blockers/keputusan-phase-8-lanjutan.md)
- [ ] Daily check-in dan skrining berkala dengan grafik tren
  - [x] Gateway: instrumen berversi, skor, rentang, interval, jawaban terenkripsi, butir keamanan → protokol + kejadian keamanan, hapus data, siklus hidup akun (unit + E2E)
  - [x] Web dan app: halaman Cek diri, form, hasil, grafik tren, hapus entri/semua (build lulus)
  - [ ] Instrumen, butir keamanan, dan teks hasil disetujui psikolog dan hukum — [keputusan-phase-8-lanjutan](blockers/keputusan-phase-8-lanjutan.md)
  - [ ] Diuji ke v3 berjalan dan di perangkat — [uji-client-ke-v3-dev](blockers/uji-client-ke-v3-dev.md)
- [ ] Inventori kepribadian saat onboarding
  - [x] Alur opsional: ditawarkan sekali setelah onboarding, bisa dilewati, skor per dimensi, hasil hanya untuk pengguna (web/app, E2E)
  - [ ] Instrumen dan tujuannya diputuskan — [keputusan-phase-8-lanjutan](blockers/keputusan-phase-8-lanjutan.md)
- [ ] Pindah ke Vertex AI RAG Engine atau pgvector saat materi melewati ambang (02 §7.3)
  - [x] Pemantau ambang: `pnpm run knowledge:budget` dan pemeriksaan di `rollout:readiness` (unit test)
  - [ ] Pindah ke RAG — belum perlu; ambang belum tercapai
- [ ] Imbalan bagi pengguna yang menyetujui consent pelatihan (bila diputuskan) — tidak dibangun; Konsep §7.1 saat ini "tidak ada imbalan"
- [ ] Persiapan ekspansi Asia Tenggara: bahasa, hotline, dan regulasi per negara
  - [x] Audit asumsi khusus Indonesia dan langkah per negara — [ekspansi-asia-tenggara](rilis/ekspansi-asia-tenggara.md)
  - [ ] Persiapan per negara — negara belum diputuskan

---

## Phase 9 — Data & Model ⛔

Mengikuti dokumen konsep §7.4. Tidak ada pekerjaan di phase ini yang boleh mendahului persetujuan yang sah.

> **Status 2026-10-14:** perangkat siap dan teruji dengan data sintetis ([recap](tasks/20261014-phase-9-data-dan-model.md), [playbook](data/pemanfaatan-data.md)). Semua job pemanfaatan data menolak berjalan sampai gerbang DPIA dan tinjauan etik dicatat oleh pemiliknya. **Belum ada data asli yang disentuh.** Menunggu [pemanfaatan-data-phase-9](blockers/pemanfaatan-data-phase-9.md).

- [ ] Permintaan consent aktif kepada pengguna lama; addendum kontrak psikolog — mekanisme selesai: consent `legacy_counseling` di web/app (diam ≠ setuju), addendum berversi dengan pilihan per pemakaian di dashboard "Penggunaan data". Teks masih DRAFT; kampanye consent dan penandatanganan addendum belum
- [ ] Ekstraksi data lama dari store `chat-service` standalone yang sudah dipensiunkan (bukan dari tabel chat v3) — impor dari berkas ekstraksi (`dataset import-legacy`) dengan penyaringan consent; ekstraksi sendiri belum dan tidak boleh sebelum gerbang dibuka
- [ ] Sensitive Data Protection + peninjauan manual sebelum data dipakai — de-identifikasi SDP (`asia-southeast2`) + tinjauan wajib oleh peran `data_reviewer` (dashboard "Data pelatihan"); diuji dengan klien DLP tiruan dan penyamar lokal; SDP sungguhan belum dipanggil ([lingkungan-gcp-dev](blockers/lingkungan-gcp-dev.md))
- [ ] Penilaian dampak pelindungan data dan tinjauan etik eksternal — bagian engineering DPIA ditulis ([dpia-phase-9-engineering](data/dpia-phase-9-engineering.md)); dokumen final dan tinjauan etik belum
- [ ] Pemanfaatan bertahap: evaluasi → contoh gaya persona → (bila memadai) fine-tuning — ekspor per tujuan dengan syarat masing-masing (izin psikolog, gerbang `fine_tuning_go`, jumlah minimum) dan jejak audit; belum ada pemanfaatan

---

## 5. Risiko

| Risiko                                                  | Tanda awal                                                  | Mitigasi                                                                                                        |
| ------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Konten psikolog tertahan                                | Phase 2 tidak bisa ditutup karena protokol krisis belum ada | Konten diperlakukan sebagai jalur kritis dengan pemilik jelas; engineering memakai placeholder `DRAFT` di `dev` |
| Respons AI tidak aman lolos ke pengguna                 | Laporan pengguna atau temuan tinjauan sampel                | Gerbang evaluasi, runbook, penonaktifan persona, rollout bertahap                                               |
| Nama psikolog terseret saat AI keliru                   | Keluhan atas respons persona                                | Persetujuan dan hak cabut persona, tinjauan berkala, kesepakatan tertulis dengan psikolog                       |
| Latensi safety gate terasa lambat                       | p95 waktu ke token pertama > 4 detik                        | Model klasifikasi yang lebih kecil; L2 hanya untuk pesan yang lolos heuristik ringan                            |
| Biaya per sesi tidak berkelanjutan untuk layanan gratis | Biaya per pengguna aktif naik di Phase 7.3                  | Batas token, pemilihan model per tugas, evaluasi kuota                                                          |
| Perubahan v3 berbenturan dengan pekerjaan rewrite       | Konflik rilis v3                                            | Perubahan v3 hanya endpoint tambahan tanpa migrasi skema, dengan recap per task                                 |
| Konektivitas lintas cloud (Dokploy ↔ GCP)               | Error atau latensi tinggi pada panggilan v3                 | Cache direktori dan katalog, retry dengan backoff, outbox untuk webhook dan push                                |
