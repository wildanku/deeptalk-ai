# Alur Awal Chat Teman AI: Data Diri, Nama Panggilan, dan Cerita

**Tanggal:** 2026-10-18
**Phase:** — (perubahan alur produk pasca Phase 9)
**Komponen:** gateway, agent, docs, deeptalk-web-v2
**Recap terkait:** [20261018-latensi-giliran-dan-refresh-chat.md](20261018-latensi-giliran-dan-refresh-chat.md), [20261016-ruang-sesi-dan-beranda-teman-ai.md](20261016-ruang-sesi-dan-beranda-teman-ai.md)

## Tujuan

Permintaan Wildan: chat baru tidak lagi langsung dibuka sebagai ruang chat dengan pemilih pendekatan. Alur barunya:

1. **Data diri**, hanya bila belum ada: jenis kelamin dan tanggal lahir. Cukup diisi sekali.
2. **Form awal**: nama panggilan (default dari nama panggilan atau nama lengkap di profil) dan cerita.
3. **Loading** yang menjelaskan bahwa proses ini mungkin agak lama.

Pengguna tidak lagi memilih Quick Chat atau pendekatan; router selalu memilihkan pendekatan dari cerita.

## Keputusan (Wildan, 18 Okt)

- **Teks loading versi jujur:** "DeepTalk AI sedang mencocokkan ceritamu dengan pendekatan yang dirancang psikolog DeepTalk". Klaim "dataset spesial" tidak dipakai karena belum bisa dibuktikan: gerbang data Phase 9 belum dibuka, dan klaim sejenis sudah dihapus di Phase 7.
- **Nama panggilan hanya berlaku untuk sesi itu.** Profil v3 tidak diubah, sehingga nama khusus untuk AI tidak ikut muncul di konseling atau booking.
- **Gender wajib hanya di web.** Gateway tetap hanya mewajibkan tanggal lahir (gerbang usia), supaya app yang belum punya form gender tidak terblokir.
- **Tawaran tes kepribadian dihapus dari layar awal.** Tes tetap tersedia di Cek Diri.

## Daftar Pekerjaan

- [x] Gateway — `session.start` menerima `nickname`:
  - zod merapikan spasi dan membatasi 1–50 karakter huruf, angka, spasi, dan `.'-`, karena nilainya masuk ke prompt;
  - nilainya disimpan di pending settings;
  - `TurnService.open` mengikatnya ke sesi baru (`session-nickname:<sesi>`, TTL 2 hari), termasuk sesi krisis.
- [x] Gateway — `memory.profile` yang dikirim ke agent:
  - nama panggilan sesi menggantikan nama panggilan profil;
  - ditambah `gender` dari profil v3. Cache konteks lama tanpa `gender` tetap aman.
- [x] Agent — `Profile.gender`; prompt persona menambahkan "Jenis kelamin: …" hanya untuk `male`, `female`, `non-binary`.
- [x] Web — `intake.tsx`:
  - `ProfileStep`: gender dan/atau tanggal lahir yang belum ada, disimpan ke profil v3 lewat `/user/profile/update`;
  - `StoryStep`: nama panggilan dengan default `nickname` atau `fullname`, plus textarea cerita berbatas 2.000 karakter.
- [x] Web — `LiveRoom` ruang baru:
  - pemilih pendekatan, tawaran tes kepribadian, dan sambutan lama diganti alur intake;
  - composer disembunyikan sebelum pesan pertama;
  - gerbang `AGE_REQUIRED` di ruang baru memakai `ProfileStep`, sehingga tanggal lahir dan gender diisi dalam satu langkah;
  - kirim: `session.start(null, nickname)` lalu cerita sebagai pesan pertama.
- [x] Web — `MatchingBubble` dengan teks loading selama balasan pertama sesi. Tetap tampil setelah refresh berkat `pending_reply`.
- [x] Web — helper `needsProfile`, `cleanNickname` (aturan sama dengan gateway), `hasGender`, `hasBirthDate` di `lib/domain/ai.ts`, ditambah teks `temanAi.intake` (id/en).
- [x] Test:
  - gateway: `session.start` dengan nickname valid/rapi/ditolak; nickname diikat ke sesi; nickname sesi dan gender sampai ke agent;
  - agent: baris jenis kelamin di prompt;
  - web: `needsProfile` dan `cleanNickname`.
- [x] Dokumen: 02 §6.2 (`session.start`), baris status web
- [ ] Cek tampilan di browser — belum: ekstensi Chrome tidak tersambung di sesi ini
- [ ] App (`deeptalk-app-v2`) — belum: follow-up. App lama tetap berjalan dengan pemilih pendekatan karena kontraknya kompatibel

## File yang Diubah

- `gateway/src/realtime/ai.gateway.ts` (+spec): skema `session.start`.
- `gateway/src/realtime/session-state.service.ts`: `nickname` di pending settings, `bindNickname`, `sessionNickname`.
- `gateway/src/realtime/turn.service.ts` (+spec): ikat nickname ke sesi baru.
- `gateway/src/realtime/conversation.service.ts` (+spec): profil ke agent.
- `gateway/src/agent-client/agent-events.ts` (+fixture spec): `profile.gender`.
- `agent/app/contract.py`, `agent/agents/persona.py`, `agent/tests/test_turn.py`.
- `docs/02-implementasi.md`.
- `../deeptalk-web-v2/src/components/teman-ai/intake.tsx` (baru), `teman-ai-chat.tsx`, `src/hooks/use-ai-session.ts`, `src/lib/domain/ai.ts` (+test), `lang/id.json`, `lang/en.json`, `docs/phase/README.md`.

## Validasi

- [x] gateway: lint, typecheck, **test 323 passed**
- [x] agent: ruff, mypy, **pytest 57 passed**
- [x] web: `tsc` bersih, lint 0 error, **vitest 144 passed**, `pnpm build` OK
- [ ] Browser — belum (lihat atas)

## Blocker

Tidak ada.

## Follow-up

- [ ] Uji di browser setelah deploy:
  - akun tanpa gender → form data diri;
  - akun lengkap → form cerita dengan nama panggilan terisi;
  - kirim → URL `/<id>`, kartu "Sebentar ya…", lalu balasan;
  - nama panggilan baru dipakai AI dan profil tidak berubah.
- [ ] App: alur intake yang sama (`src/app/teman-ai/index.tsx`, `use-ai-session.ts`).
- [ ] Komponen `persona-picker.tsx` dan `personality-offer.tsx` kini tidak dipakai di web. Hapus bila keputusan ini permanen.

## Rekap Status

**Status:** 🟨 Sebagian
**Progres:** 9/11 item selesai

| Belum selesai | Alasan |
|---|---|
| Cek tampilan di browser | belum: ekstensi Chrome tidak tersambung |
| App | belum: follow-up sesuai keputusan cakupan sebelumnya |
