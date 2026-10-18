# Kartu Sorotan (Rekomendasi Psikolog & Rutinitas) dan Chat Layar Penuh

**Tanggal:** 2026-10-16
**Phase:** UAT [cek-flow-mvp-151026 §4](../../../docs/deeptalk-ai/cek-flow-mvp-151026.md)
**Komponen:** gateway, `deeptalk-web-v2`
**Terkait:** [20261016-ruang-sesi-dan-beranda-teman-ai](20261016-ruang-sesi-dan-beranda-teman-ai.md), [20261016-rekomendasi-psikolog](20261016-rekomendasi-psikolog.md)

## Tujuan

1. Rekomendasi psikolog dan saran Daily Routine di sesi chat tampil sebagai kartu sorotan, menempel pada balasan AI yang memunculkannya.
2. Halaman chat layar penuh (web desktop dan mobile), hanya tombol kembali dan akhiri sesi.

**Kondisi sebelumnya:** kartu ditumpuk di bawah semua pesan (tidak terkait balasan mana), hilang setelah reload atau di transkrip (rekomendasi tidak disimpan isinya; rutinitas hanya yang belum diputuskan), dan lenyap setelah diputuskan (rutinitas ditolak → hilang; rekomendasi "Nanti saja" → hilang).

## Daftar Pekerjaan

### Gateway
- [x] Migrasi additive `…_session_card_anchors`: `message_id` di `ai_routine_proposals` dan `ai_psikolog_recommendations`, `card_ciphertext` (isi kartu rekomendasi, terenkripsi seperti pesan, AAD = ID baris), index `ai_routine_proposals(session_id)` — hanya DB lokal
- [x] `stream()` mengembalikan ID balasan; kartu menyimpan dan mengirim `message_id` (`card.routine` juga `status`, `card.assessment` juga `message_id`)
- [x] `cards` di `GET /sessions/current` dan `GET /sessions/:id` (rutinitas semua status + rekomendasi terdekripsi, urut waktu); `pending_cards` dipertahankan untuk app
- [x] Spec: `recommendations.service.spec.ts` (terenkripsi, ber-jangkar, terbaca kembali), `sessions.controller.spec.ts` (+ urutan dan jangkar kartu), `conversation.service.spec.ts` (`messageId` = ID di `ai.done`)
- [x] lint, typecheck, test (42 suite / 287 test), test:e2e (2), build

### Web
- [x] Kartu menempel di bawah balasan AI asalnya (live dan transkrip); tanpa jangkar → setelah percakapan (`anchorCards`, `CardStack`)
- [x] `HighlightCard`: bingkai bergradien + pita berikon; ungu untuk "Rekomendasi psikolog untukmu", oranye untuk "Saran Daily Routine"; versi redup bila sudah selesai
- [x] Kartu tetap terlihat setelah diputuskan: rutinitas tersimpan (+ tautan Rutinitas) / "Kamu memilih tidak sekarang" / tidak diputuskan; rekomendasi tanpa "Nanti saja", psikolog yang sudah dibuka diberi tanda "Sudah dilihat". Hook tidak lagi menghapus kartu setelah keputusan (sebelumnya pesan "Routine tersimpan" langsung hilang)
- [x] Kartu dimuat ulang dari `cards` server (reload, kembali dari beranda, transkrip baca-saja)
- [x] Chat layar penuh tanpa navbar/footer situs (`/teman-ai/[id]` tanpa `AppShell`, `100dvh`, safe-area); header hanya kembali + akhiri sesi, dengan judul persona + label AI; isi di kolom tengah yang mudah dibaca. Bantuan darurat dipindah ke baris di bawah kotak ketik ("Butuh bantuan segera? Bantuan darurat")
- [x] Copy `id.json`/`en.json`; typecheck, lint (0 error; 2 peringatan lama), vitest (128), build
- [x] Perbaikan (permintaan lanjutan): jarak kosong di bawah ruang chat — `RoomFrame` `fixed inset-0`, kotak ketik / footer sesi berakhir jadi bar yang menempel di tepi bawah (garis atas + latar, seperti header), padding bawah dirapatkan dengan safe-area
- [x] Lanjutan: indikator balasan bertahap (`ThinkingBubble`) — balasan pertama: "menyimak ceritamu" → (3,5 dtk) penjelasan + ajakan menarik napas → (15 dtk) terima kasih sudah sabar; balasan berikutnya versi singkat
- [x] Lanjutan: efek ketik (`SmoothText`) untuk balasan yang di-stream — 0 token tambahan (streaming sudah ada: Gemini SSE → agent → `ai.token`); kecepatan adaptif (min 80 karakter/dtk, mengejar sisa ±1,1 dtk), kursor, tanpa loncatan saat `ai.done` (gelembung streaming dan tersimpan berbagi `key`), teks pengganti L3 tampil langsung, hormati `prefers-reduced-motion`; auto-scroll lewat `ResizeObserver` hanya bila pembaca di bawah
- [ ] Cek visual di browser (desktop + mobile) — belum: ekstensi Chrome tidak tersambung

### Verifikasi
- [x] Uji dengan Argon: kartu rekomendasi ber-`message_id` = balasan yang menyebut psikolog; kembali utuh dari `/sessions/:id` dan `/sessions/current`. Kartu rutinitas tidak muncul karena Vertex lambat: L2 timeout di dua giliran → sesi `elevated` → rutinitas tidak ditawarkan (aturan 02 §7.4); giliran pertama `AGENT_UNAVAILABLE` setelah 114 dtk
- [x] Uji jalur rutinitas dengan model lokal deterministik (agent sementara `MODEL_PROVIDER=local`, lalu dikembalikan ke `vertex`): 7/7 — kedua kartu ber-jangkar, rutinitas ditolak tetap ada sebagai `rejected`, semua kembali dari server
- [x] Halaman `/teman-ai/baru` dan `/teman-ai/<id>` 200 tanpa header situs; `/teman-ai` tetap dengan header; tanpa error di log
- [x] 02 §6.2 (payload kartu), §6.2a (`cards`), §8 (kolom baru)

## File yang Diubah

**deeptalk-ai/gateway**
- `prisma/schema.prisma`, `prisma/migrations/*_session_card_anchors/`
- `src/realtime/conversation.service.ts`, `conversation.service.spec.ts`
- `src/routines/routines.service.ts`
- `src/recommendations/recommendations.service.ts`, `recommendations.service.spec.ts` (baru), `recommendations.module.ts`
- `src/sessions/sessions.controller.ts`, `sessions.controller.spec.ts`

**deeptalk-ai/docs**
- `02-implementasi.md`, `tasks/20261016-kartu-sorotan-dan-chat-layar-penuh.md`

**deeptalk-web-v2**
- `src/app/[lang]/teman-ai/[id]/page.tsx`
- `src/components/teman-ai/teman-ai-chat.tsx`, `highlight-card.tsx` (baru), `routine-card.tsx`, `recommendation-card.tsx`
- `src/hooks/use-ai-session.ts`, `src/lib/domain/ai.ts`
- `lang/id.json`, `lang/en.json`

## Keputusan

- **Jangkar = ID balasan AI** yang memunculkan kartu, disimpan di server. Kartu dari sebelum perubahan ini (tanpa jangkar) tetap tampil, di akhir percakapan.
- **Isi kartu rekomendasi disimpan terenkripsi**: alasan per psikolog ditulis model dari cerita pengguna, jadi diperlakukan seperti isi pesan (02 §9.1). Rutinitas mengikuti penyimpanan yang sudah ada.
- **Kartu tidak bisa ditutup**: sorotan tetap menjadi bagian percakapan; yang berubah hanya statusnya.
- **Bantuan darurat tidak di header** sesuai permintaan (hanya kembali + akhiri), tetapi tetap satu ketukan di bawah kotak ketik, dan protokol krisis tetap muncul otomatis.

## Blocker

Tidak ada.

## Follow-up

- Latensi balasan pertama (token pertama 5–13 dtk) didominasi safety gate L2 (wajib, 02 §7.2) dan router Quick Chat (panggilan model berurutan sebelum persona). Opsi tanpa menambah token: lewati router bila pengguna memilih pendekatan sendiri; jalankan router paralel dengan L2.

- Latensi Vertex/Argon saat uji: L2 sering timeout (→ `elevated`, rutinitas tidak ditawarkan) dan satu giliran > 114 dtk. Perlu dipantau; bila berulang, tinjau `SAFETY_TIMEOUT_MS` dan batas waktu agent.
- App (`deeptalk-app-v2`): jangkar kartu dan `cards` dari server.
- Cek visual layar penuh di desktop dan mobile (safe-area iOS).
- Akun uji kini punya satu sesi (`01a143f8-b5b3-…`) berisi balasan model lokal (`[model lokal] …`) di riwayat.

## Rekap Status

- **Selesai:** 18/19
- **Belum:** cek visual browser
- **Status task:** ✅ Selesai — kartu sorotan ber-jangkar dan tersimpan, chat layar penuh; tampilan belum dilihat di browser.
