# Rekomendasi Psikolog di Teman AI (`card.recommendation`)

**Tanggal:** 2026-10-16
**Phase:** UAT [cek-flow-mvp-151026 §4](../../../docs/deeptalk-ai/cek-flow-mvp-151026.md) (temuan uji sisi pengguna)
**Komponen:** gateway, agent, `deeptalk-web-v2`
**Terkait:** [20261016-uji-lokal-alur-pengguna-web](20261016-uji-lokal-alur-pengguna-web.md)

## Tujuan

Saat pengguna meminta rekomendasi psikolog (atau situasinya butuh profesional), Teman AI menyebut 1–3 psikolog DeepTalk yang cocok dan menampilkan kartu rekomendasi. Sebelumnya AI menjawab "tidak punya akses".

**Penyebab:** katalog psikolog untuk agent hanya diambil dari `ai_handoff_psikologs` (opt-in handoff) yang kosong dan tidak pernah diisi kode mana pun, sehingga `allow_handoff` selalu `false`; prompt persona juga tidak pernah menerima daftar psikolog.

Keputusan Wildan:
1. Kartu rekomendasi baru (1–3 psikolog), terpisah dari kartu handoff ringkasan.
2. Kandidat = semua psikolog di direktori v3; psikolog dengan persona aktif diprioritaskan (pendekatan + topik fokus), sisanya lewat spesialisasi + rating. Opt-in `ai_handoff_psikologs` tetap hanya untuk berbagi ringkasan.
3. Web dulu; app menyusul.
4. Env opsional `PSIKOLOG_DIRECTORY_API_URL` di gateway (default `DEEPTALK_API_URL`) untuk membaca direktori; lokal → v3 dev live.

## Daftar Pekerjaan

### Gateway
- [x] Env `PSIKOLOG_DIRECTORY_API_URL` (skema, `.env.example`, 02 §11.1)
- [x] `V3Client.psikologDirectory()`: seluruh halaman `/user/find/psikologs` (`offset=100`, maks. 10 halaman), cache Redis 5 menit; `psikolog()` ikut memakai host direktori
- [x] `RecommendationsService.candidates()`: direktori + persona aktif; urutan persona yang cocok topik → persona lain → bergilir per spesialisasi berdasarkan rating berbobot ulasan; maks. 15
- [x] Konteks giliran: `state.allow_recommendation`, `catalog.directory` (tidak saat `crisis`, sekali per sesi)
- [x] Validasi kartu `recommendation` (1–3 ID unik yang ada di direktori), simpan `ai_psikolog_recommendations`, emit `card.recommendation`
- [x] Migrasi additive `20261016074619_psikolog_recommendations` (diterapkan ke DB lokal saja) + `POST /v1/recommendations/:id/opened`
- [x] Hapus riwayat / hapus akun / merge akun menyertakan tabel baru
- [x] Spec: `recommendation-rules.spec.ts` (7), `conversation.service.spec.ts` (kartu rekomendasi + isi katalog ke agent)

### Agent
- [x] Kontrak: `TurnState.allow_recommendation`, `Catalog.directory`, `CardDecision.recommendation` (item tidak dibatasi di skema; dipangkas di `cards.decide` agar satu jawaban model yang kelebihan tidak menggagalkan semua kartu)
- [x] Prompt persona: daftar psikolog yang bisa direkomendasikan + aturan; bila kartu sudah ditawarkan, rujuk ke kartu / menu Cari Psikolog
- [x] Prompt `cards-v1-draft` (DRAFT): aturan rekomendasi konsisten dengan balasan; model lokal mendukung rekomendasi
- [x] Aturan global `global-v1-draft` (DRAFT): jangan bilang tidak punya akses; tanpa daftar → menu Cari Psikolog
- [x] Test: `tests/test_recommendation.py` (4)

### Web
- [x] Tipe `AiRecommendationCard`, event `card.recommendation` di `useAiSession`, `RecommendationCardView` (foto, rating, pengalaman, harga mulai, spesialisasi, label persona, alasan), tautan `/psychologists/[id]`, `recommendationOpened`, tombol "Lihat semua psikolog"
- [x] Copy `temanAi.recommendationCard` di `id.json`/`en.json`
- [ ] Cek visual di browser — belum: ekstensi Chrome tidak tersambung di sesi ini

### Dokumen dan verifikasi
- [x] 02 §6.2 (event), §6.2a REST, §7.4 (validasi + aturan kandidat), §8 (tabel), §11.1 (env)
- [x] gateway: lint, typecheck, test (40 suite / 281 test), test:e2e (2), build; agent: ruff format/check, mypy, pytest (47); web: typecheck, eslint, vitest (128)
- [x] Uji lokal dengan Argon (lihat Validasi)
- [ ] App (`deeptalk-app-v2`) — belum: keputusan "web dulu"; app juga belum punya kartu handoff

## File yang Diubah

**deeptalk-ai/gateway**
- `src/config/env.schema.ts`, `.env.example`
- `src/v3-client/v3-client.service.ts`
- `src/recommendations/` (baru): `recommendation-rules.ts`, `recommendation-rules.spec.ts`, `recommendations.service.ts`, `recommendations.controller.ts`, `recommendations.module.ts`
- `src/agent-client/agent-events.ts`, `src/agent-client/agent-client.service.spec.ts`
- `src/realtime/conversation.service.ts`, `conversation.service.spec.ts`, `realtime.module.ts`
- `src/lifecycle/lifecycle.service.ts`
- `prisma/schema.prisma`, `prisma/migrations/20261016074619_psikolog_recommendations/`

**deeptalk-ai/agent**
- `app/contract.py`, `app/turn.py`, `agents/cards.py`, `agents/persona.py`
- `prompts/__init__.py`, `prompts/global/v1-draft.md`, `prompts/cards/v1-draft.md` (baru; v0 tidak diubah)
- `tests/test_recommendation.py` (baru)

**deeptalk-ai/docs**
- `02-implementasi.md`, `tasks/20261016-rekomendasi-psikolog.md`

**deeptalk-web-v2**
- `src/lib/domain/ai.ts`, `src/lib/api/ai.ts`, `src/hooks/use-ai-session.ts`
- `src/components/teman-ai/recommendation-card.tsx` (baru), `teman-ai-chat.tsx`
- `lang/id.json`, `lang/en.json`

**Lokal, tidak di-commit**
- `deeptalk-ai/gateway/.env`: `PSIKOLOG_DIRECTORY_API_URL=https://api-deeptalk.lgs.web.id`
- DB lokal `deeptalk_ai_dev`: migrasi baru diterapkan

## Keputusan

- **Rekomendasi tanpa opt-in, handoff tetap opt-in.** Kartu rekomendasi hanya menautkan profil publik (sama seperti halaman Cari Psikolog); handoff membagikan ringkasan percakapan, jadi tetap butuh `ai_handoff_psikologs`.
- **Persona ikut menerima daftar kandidat**, bukan hanya penentu kartu. Kartu diputuskan setelah balasan, jadi tanpa daftar di prompt persona balasan dan kartu tidak bisa konsisten (dan model menjawab "tidak punya akses").
- **Pencocokan cerita ↔ psikolog diserahkan ke model**; gateway hanya membatasi daftar (15) secara deterministik tanpa pemetaan topik → spesialisasi buatan engineering (itu konten klinis).
- **Validasi gateway terhadap seluruh direktori**, bukan hanya 15 kandidat giliran itu: data publik, dan validasi tidak perlu mengulang perhitungan topik.
- **Prompt versi baru (`v1-draft`)**, bukan mengubah `v0-draft`, karena versi prompt dicatat per pesan.

## Validasi

Uji lokal 16 Okt (Argon, akun uji sintetis, direktori v3 dev 318 psikolog):
- "Boleh rekomendasiin psikolog DeepTalk yang cocok?" setelah cerita stres kerja + susah tidur + ragu karier → balasan menyebut 3 psikolog, kartu berisi 3 psikolog yang **sama dan berurutan sama**: Wildan Maulana (persona Mindfulness & Penerimaan; topik fokus `stres_kerja, burnout, kecemasan, sulit_tidur` — klaim di balasan sesuai Persona Card), lalu dua psikolog spesialis Karir. Alasan per psikolog sesuai data (pengalaman, spesialisasi).
- Diminta lagi di sesi yang sama → tidak ada kartu kedua; AI merujuk ke kartu di atas dan menu Cari Psikolog.
- `ai_psikolog_recommendations` tercatat; `opened` dengan psikolog di luar kartu diabaikan, di dalam kartu tercatat, tanpa token 401.
- `/psychologists/SPSYD7HDETVGQ` di web lokal 200 (harga/rating kosong di lokal karena DB v3 lokal kosong; di dev/prod kartu dan profil dari v3 yang sama).
- Catatan: giliran pertama setelah agent di-restart → L2 timeout (cold start Vertex) → `elevated`, token pertama 56 dtk. Bukan dari perubahan ini (L2 terpisah dari prompt persona); giliran berikutnya normal (4–8 dtk).

## Blocker

Tidak ada.

## Follow-up

- App (`deeptalk-app-v2`): event `card.recommendation` + kartu (juga kartu handoff yang belum ada di app).
- Indikator dampak: tambahkan `ai_psikolog_recommendations` ke `/v1/review/impact` dan dashboard Dampak.
- `ai_handoff_psikologs` masih tidak punya jalur pengisian (endpoint/menu dashboard untuk psikolog opt-in), sehingga kartu handoff ringkasan tetap tidak pernah muncul.
- Tinjauan psikolog untuk teks prompt `global-v1-draft` dan `cards-v1-draft` (DRAFT).
- Cold start L2 setelah deploy/restart: pertimbangkan warm-up agent (min instance / panggilan pemanasan).
- Cek visual kartu di browser (desktop + mobile).

## Rekap Status

- **Selesai:** 18/20
- **Belum:** cek visual browser; app
- **Status task:** ✅ Selesai untuk web — rekomendasi psikolog berjalan ujung ke ujung dengan Argon; app menyusul sesuai keputusan.
