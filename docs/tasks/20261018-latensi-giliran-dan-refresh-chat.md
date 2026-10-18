# Latensi Giliran (>60 dtk → Timeout) dan Balasan Tetap Sampai Saat Web Di-refresh

**Tanggal:** 2026-10-18
**Phase:** — (perbaikan produksi pasca Phase 9)
**Komponen:** agent, gateway, infra, e2e, docs, deeptalk-web-v2
**Recap terkait:** [20261016-kesiapan-deploy-cloud-run.md](20261016-kesiapan-deploy-cloud-run.md), [20261015-uji-lokal-gemini-4-argon.md](20261015-uji-lokal-gemini-4-argon.md), [20261016-kartu-sorotan-dan-chat-layar-penuh.md](20261016-kartu-sorotan-dan-chat-layar-penuh.md)

## Tujuan

1. Giliran di production kadang lebih dari 1 menit lalu `ai.error`. Penyebab di kode:
   - hanya L2 yang punya batas waktu; persona, kartu, dan router tanpa timeout maupun retry;
   - klien Gemini (beserta auth dan TLS ke `us`) dibuat ulang untuk setiap panggilan;
   - keputusan kartu berjalan berurutan dan menahan `done`, sehingga balasan baru tersimpan setelah kartu selesai;
   - gateway memakai satu tenggat total 60 dtk untuk seluruh stream.
2. Refresh browser saat AI membalas menghilangkan pesan di web:
   - transkrip tersembunyi di balik gerbang onboarding sampai socket tersambung;
   - riwayat dipotong 50 pesan;
   - URL `/baru` belum berganti;
   - tidak ada penanda balasan yang sedang berjalan atau gagal.

## Daftar Pekerjaan

### Agent
- [x] A1 Satu `Gemini` bersama per tier (`client_kwargs.http_options`: `MODEL_HTTP_TIMEOUT_MS` 30 dtk, retry `MODEL_RETRY_ATTEMPTS` 2 untuk 408/429/5xx), dipakai persona dan semua panggilan terstruktur
- [x] A2 Tenggat per tahap:
  - token pertama telat (`PERSONA_FIRST_TOKEN_TIMEOUT_MS` 15 dtk) → diulang sekali tanpa terlihat pengguna;
  - `PERSONA_TIMEOUT_MS` 45 dtk → `MODEL_TIMEOUT`;
  - `CARDS_TIMEOUT_MS` 8 dtk → kartu dilewati.
- [x] A3 Event `done` dikirim sebelum `structured`
- [x] A4 Warm-up `count_tokens` saat startup (background, gagal hanya dicatat; `MODEL_WARMUP`)
- [x] A5 Satu log `turn timing` per giliran di semua jalur keluar, berisi field terstruktur tanpa isi. Durasi router dan classify juga dicatat (`step_timing`); `app/logging.py` kini menerima `extra={"fields": …}`
- [x] Test pytest:
  - kartu setelah `done`;
  - kartu lambat tidak menahan balasan;
  - retry token pertama;
  - `MODEL_TIMEOUT`;
  - log timing tanpa isi;
  - instance `Gemini` bersama dengan timeout/retry;
  - warm-up lokal.

### Gateway
- [x] B1 Batas waktu baru dan kode error:
  - `AGENT_TURN_TIMEOUT_MS` (75 dtk sampai `done`), `AGENT_IDLE_TIMEOUT_MS` (30 dtk antar-chunk), `AGENT_CARDS_GRACE_MS` (10 dtk setelah `done`), `ROUTER_TIMEOUT_MS` (8 dtk);
  - jam mulai setelah ID token didapat;
  - kode `TIMEOUT_TOTAL`/`TIMEOUT_IDLE`;
  - TTL lock mengikuti `AGENT_TURN_TIMEOUT_MS`.
- [x] B2 Balasan disimpan, lock dilepas, dan `ai.done` dikirim begitu event `done` tiba. Kartu dibaca sesudahnya; kegagalan setelah `done` hanya membuang kartu (`cards_dropped`). Agent lama (kartu sebelum `done`) tetap didukung
- [x] B3 Penanda giliran berjalan:
  - Redis `turn:inflight:<sesi>` berisi `{user_message_id, message_id, started_at}`, hanya ID; dihapus saat `done`/error/selesai;
  - `GET /sessions/current` mengembalikan `pending_reply`;
  - pesan user membawa `client_message_id`.
- [x] B4 `session_id` di ack `message.send`
- [x] B5 `created_at` (waktu server) di `ai.done`
- [x] B6 Direktori v3: single-flight per instance + cache negatif 30 dtk setelah gagal
- [x] B7 KMS unwrap: dedupe untuk unwrap yang sedang berjalan
- [x] B8 Metrik dan Terraform:
  - field `ai_turn`: `router_ms`, `context_ms`, `agent_first_event_ms`;
  - di Terraform: label `error` pada `ai_turn`, distribusi `ai_turn_duration_ms` dan `agent_turn_*` (dari log agent), alert durasi p95 > 30 dtk, tiga chart dashboard.
- [x] Test Jest:
  - timeout idle, total, dan tenggang kartu; jam mulai setelah auth; router timeout;
  - penanda in-flight; kartu setelah `done`; stream putus setelah `done`;
  - `pending_reply`; ack `session_id`; single-flight v3; dedupe KMS.
- [x] Perbaikan spec lama `turn.service.spec.ts` (mock `pendingSettings` dan argumen locale): 7 test sudah gagal di HEAD sebelum task ini
- [x] Skenario E2E baru di `e2e/resilience.mjs`: reload di tengah giliran → `pending_reply` → balasan sampai ke socket baru atau ke riwayat → penanda hilang

### Web (deeptalk-web-v2)
- [x] C1 Transkrip sesi yang sudah ada tampil tanpa menunggu socket dan cek onboarding (`gated = onboarding.data ? !ready : sessionId === null`)
- [x] C2 `SessionRoute` meneruskan transkrip `/sessions/:id` (hingga 200) sebagai isi awal `LiveRoom` → `useAiSession(…, initialMessages)`
- [x] C3 `createdId` dari `session_id` di ack, sehingga URL `/baru` → `/<id>` tanpa menunggu `session.state`
- [x] C4 Lanjutkan balasan setelah refresh:
  - `pending_reply` → indikator mengetik (`ThinkingBubble`), kirim dinonaktifkan;
  - delta tanpa awal tidak ditampilkan; `ai.done` membawa teks lengkap;
  - riwayat dibaca ulang saat socket bergabung dan setelah 20 dtk tanpa tanda;
  - pesan user tanpa balasan → "coba lagi" idempoten;
  - `created_at` dari server.
- [x] C5 Vitest: `resumeFromHistory` (4 kasus) dan `appendDelta` untuk stream yang dilanjutkan
- [ ] Cek di browser ke stack lokal (refresh di tengah balasan) — belum: web di port 3000 milik Wildan diarahkan ke API dev dan gateway Cloud Run, bukan ke stack lokal, dan sengaja tidak diubah. Jalur server sudah diuji E2E; lihat Follow-up

### Dokumen dan konfigurasi
- [x] Saran Cloud Run + Firebase App Hosting di `../docs/deeptalk-ai/setup-gcp-agent-platform-argon.md` §5.11:
  - perintah `describe`/`update` dan alasan setiap flag;
  - flag baru di §5.7/§5.9;
  - catatan region SG.
- [x] Perbarui `topologi-deployment-151026.md`: setelan baris agent/gateway dan catatan region SG selama testing/kompetisi
- [x] 02-implementasi (§6.2 ack/`ai.done` + paragraf reload, §6.2a `pending_reply`, §6.4 urutan, §7.1 event dan batas waktu, §11.1 env), `slo.md` (durasi giliran), runbook `gangguan-vertex-ai.md` (tabel kode error, langkah giliran lambat), `.env.example` agent dan gateway, skill agent, blocker `latensi-l2-argon`
- [x] Baris status di `deeptalk-web-v2/docs/phase/README.md`
- [ ] Terapkan konfigurasi Cloud Run dan Firebase di production — belum: dijalankan Wildan (perintah di setup §5.11). `SAFETY_TIMEOUT_MS=6000` butuh persetujuan lead
- [ ] `terraform validate`/`plan` untuk `infra/modules/monitoring` — belum: `terraform` tidak terpasang di mesin ini

## File yang Diubah

- `agent/agents/llm.py`: `Gemini` bersama per tier dengan `http_options` (timeout dan retry), plus `warm_up()`.
- `agent/app/turn.py`: tenggat per tahap, retry token pertama, `done` sebelum kartu, `TurnTiming`, dan penutupan generator dalam secara eksplisit.
- `agent/app/config.py`: enam env baru.
- `agent/app/main.py`: lifespan warm-up.
- `agent/app/routes/v1.py`: durasi router/classify.
- `agent/app/logging.py`: field terstruktur.
- `agent/tests/test_turn.py`, `agent/tests/test_llm_config.py`, `agent/.env.example`.
- `gateway/src/agent-client/agent-client.service.ts`, `agent-events.ts`: tiga jam (total, idle, tenggang) dan kode timeout.
- `gateway/src/config/env.schema.ts`: empat env baru.
- `gateway/src/realtime/conversation.service.ts`: penyimpanan saat `done` (`deliver`), penanda in-flight, metrik tahap.
- `gateway/src/realtime/turn.service.ts`: ack `session_id`, TTL lock.
- `gateway/src/sessions/sessions.controller.ts`, `session-timers.service.ts`: `pending_reply`, `turnInflightKey`.
- `gateway/src/messages/messages.service.ts`: `client_message_id` di `PlainMessage`.
- `gateway/src/v3-client/v3-client.service.ts` (+ spec baru): single-flight dan cache negatif.
- `gateway/src/messages/crypto/kms-key-provider.ts` (+ spec): dedupe unwrap.
- Spec gateway: `agent-client.service.spec.ts`, `conversation.service.spec.ts`, `turn.service.spec.ts`, `sessions.controller.spec.ts`, `message-cipher.service.spec.ts`.
- `gateway/.env.example`.
- `infra/modules/monitoring/{metrics,alerts,dashboard,variables}.tf`.
- `e2e/resilience.mjs`.
- `docs/02-implementasi.md`, `docs/slo.md`, `docs/runbooks/gangguan-vertex-ai.md`, `docs/blockers/latensi-l2-argon.md`, `.claude/skills/agent/SKILL.md`.
- `../docs/deeptalk-ai/setup-gcp-agent-platform-argon.md`, `../docs/deeptalk-ai/topologi-deployment-151026.md`.
- `../deeptalk-web-v2/src/hooks/use-ai-session.ts`, `src/lib/domain/ai.ts` (+ test), `src/components/teman-ai/teman-ai-chat.tsx`, `docs/phase/README.md`.

## Keputusan

- **`done` sebelum kartu.** Kartu bersifat opsional. Menahan balasan demi satu panggilan model tambahan adalah penyebab langsung balasan yang sudah terlihat lalu gagal di detik ke-60 dan tidak tersimpan. Kontraknya kompatibel dua arah.
- **Agent memutus lebih dulu.** `PERSONA_TIMEOUT_MS` (45 dtk) + L2 tetap di bawah `AGENT_TURN_TIMEOUT_MS` (75 dtk). Dengan begitu giliran lambat berakhir dengan `MODEL_TIMEOUT` yang jelas, bukan koneksi yang terputus.
- **Retry token pertama hanya sekali, dan hanya bila belum ada token.** Tidak ada teks yang pernah dilepas, jadi retry tidak terlihat oleh pengguna. Safety gate tidak berubah: vonis L2 tetap ditunggu sebelum token apa pun keluar.
- **`MODEL_HTTP_TIMEOUT_MS` = 30 dtk, bukan 20 dtk.** google-genai mengirim timeout sebagai `X-Server-Timeout`, sehingga nilainya menjadi tenggat total satu panggilan, streaming termasuk.
- **Penanda in-flight hanya berisi ID.** Teks parsial tidak di-buffer (aturan 4), karena `ai.done` sudah membawa teks lengkap.
- **App menyusul** (keputusan Wildan). Field kontrak baru semuanya opsional, jadi app lama tetap berjalan.

## Validasi

- [x] agent: `ruff format`, `ruff check` bersih; `mypy` 34 file bersih; **pytest 57 passed**
- [x] gateway: `lint` bersih, `typecheck` bersih, **test 320 passed (45 suite)**, `test:e2e` 2 passed, `build` OK
- [x] web: `tsc --noEmit` bersih; `lint` 0 error (2 warning lama di file lain); **vitest 142 passed**; `pnpm build` OK
- [x] E2E lokal (`e2e/run.sh`, DB sekali pakai `deeptalk_ai_e2e`, konten disalin dari `deeptalk_ai_dev` karena seed gagal, lihat Temuan):
  - `resilience` **ALL PASSED**, termasuk 5 cek reload baru;
  - `limits` **ALL PASSED**;
  - `phase2-3`: 3 cek gagal (daftar persona, label, `card.handoff`). Kegagalan yang **sama persis muncul di kode HEAD** dengan DB yang sama (diuji dengan `git stash`), karena konten salinan DB dev berbeda dari hasil seed (4 persona, tanpa katalog handoff). Jadi bukan regresi.
- [x] `evals.smoke_model` dengan Argon sungguhan (proyek trial, `SAFETY_TIMEOUT_MS=6000`):
  - klien bersama dengan `http_options` bekerja ke Vertex `us`; urutan event `safety → token → done`, tanpa error;
  - **Vertex sedang lambat**: L2 timeout di 6 dtk untuk kedua pesan uji, router 16,8 dtk, tier dokumen 8,3 dtk.
  - Pembanding dengan kode HEAD (agent di-stash) menunjukkan pola yang sama: L2 timeout, router 20,9 dtk, chat 14,1 dtk, giliran 14,0 dtk.
  - Kesimpulan: latensi Argon fluktuatif dan bisa jauh di atas pengukuran 15 Okt. Inilah yang sebelumnya menembus 60 dtk tanpa batas apa pun.
- [ ] Cek browser ke stack lokal — belum (lihat Daftar Pekerjaan)

## Temuan di luar task

- `pnpm run content:seed` gagal di DB kosong: `content/consents/service.json` → `translations.en.summary[2]` melebihi 300 karakter (validasi zod seed). Masalah ini sudah ada sejak commit `e565cc3`, tidak terkait task ini. Akibatnya E2E di DB baru tidak bisa di-seed.
- `turn.service.spec.ts` gagal 7 test di HEAD (mock belum mengikuti `pendingSettings`). Sudah diperbaiki di task ini.

## Blocker

- [latensi-l2-argon](../blockers/latensi-l2-argon.md): diperbarui. Production masih memakai `SAFETY_TIMEOUT_MS` 3.000 karena perintah deploy tidak pernah mengesetnya. Perintahnya sudah disiapkan dan menunggu persetujuan lead. Hasil smoke hari ini menunjukkan L2 bisa melewati 6 dtk saat Vertex lambat.

## Follow-up

- [ ] Wildan: terapkan setup §5.11:
  - gateway `--no-cpu-throttling --concurrency=500 --cpu-boost`;
  - agent `--min-instances=1 --cpu=2 --memory=2Gi --concurrency=30 --cpu-boost --timeout=120`;
  - env baru di kedua service;
  - Firebase `runConfig.minInstances: 1`.
  Lalu ukur dari log `turn timing` (≥ 50 giliran).
- [ ] Cek browser: jalankan web dengan `NEXT_PUBLIC_API_URL=http://localhost:3100/v2 AI_GATEWAY_URL=http://localhost:8080`, agent `MODEL_PROVIDER=local LOCAL_MODEL_TOKEN_DELAY_MS=400`, lalu refresh di tengah balasan di `/deeptalk-ai/baru` dan di `/deeptalk-ai/<id>`.
- [ ] App (`deeptalk-app-v2` feat/ai-phase-1): port C1/C3/C4 ke `src/hooks/use-ai-session.ts` dan layar Teman AI.
- [ ] Perbaiki ringkasan consent `en` yang melebihi 300 karakter (konten, butuh peninjau), atau longgarkan batas skema seed bila memang disengaja.
- [ ] Bila router tetap sering > 8 dtk di production, pertimbangkan melewati router saat pengguna sudah memilih pendekatan (lihat recap 16 Okt).
- [ ] `terraform plan` untuk modul monitoring di lingkungan yang punya `terraform`.

## Rekap Status

**Status:** 🟨 Sebagian
**Progres:** 26/29 item selesai

| Belum selesai | Alasan |
|---|---|
| Cek browser ke stack lokal | belum: web di port 3000 milik Wildan mengarah ke dev/Cloud Run; jalur server sudah diuji E2E |
| Terapkan konfigurasi Cloud Run/Firebase di production | belum: dijalankan Wildan; `SAFETY_TIMEOUT_MS` butuh persetujuan lead ([latensi-l2-argon](../blockers/latensi-l2-argon.md)) |
| `terraform validate`/`plan` monitoring | belum: `terraform` tidak terpasang |
