# Card DeepTalk AI di Beranda Dashboard Psikolog

**Tanggal:** 2026-10-15
**Phase:** Phase 5 (portal psikolog), kekurangan B1 di [cek-flow-mvp-151026](../../../docs/deeptalk-ai/cek-flow-mvp-151026.md)
**Komponen:** gateway, `psikolog-deeptalk-dashboard`

## Tujuan

Psikolog melihat ajakan mengisi kuesioner DeepTalk AI langsung di Beranda dashboard, dengan status penyusunan personanya. Membuka Beranda tidak boleh membuat workspace persona, karena hitungan "sudah mulai menyusun" di halaman Cakupan harus tetap jujur.

## Daftar Pekerjaan

- [x] Gateway: `GET /v1/psikolog/persona/status` yang hanya membaca (tanpa `upsert` workspace), dengan tahapan penyusunan persona
- [x] Unit test tahapan dan endpoint tanpa efek samping (12 test)
- [x] Dashboard: card "Persona DeepTalk AI Anda" di Beranda, tampil hanya bila token AI psikolog tersedia, dengan tautan ke "Persona saya"
- [x] Verifikasi: lint/typecheck/test/build gateway; tsc/lint/build dashboard; E2E `phase4-5` dengan 5 pemeriksaan status
- [x] Dokumentasi: 02, skill gateway, dokumen cek flow
- [ ] Lihat card di browser dengan login psikolog nyata — terblokir: v3 hosting belum punya modul AI ([uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md))

## File yang Diubah

**deeptalk-ai**
- `gateway/src/evals/persona-status.ts` (+ `persona-status.spec.ts`) — tahapan penyusunan persona (baru)
- `gateway/src/evals/persona-workspace.service.ts` — method `status` (hanya baca)
- `gateway/src/evals/psikolog.controller.ts` — `GET /psikolog/persona/status`
- `e2e/phase4-5.mjs` — pemeriksaan status di setiap tahap kurasi
- `docs/02-implementasi.md`, `.claude/skills/gateway/SKILL.md`

**psikolog-deeptalk-dashboard** (`feat/ai-phase-5`, belum di-commit)
- `features/teman-ai/types.ts` (`PersonaStage`, `PersonaStatus`), `api.ts` (`personaStatus`), `hooks.ts` (`usePersonaStatus`)
- `components/teman-ai/persona-home-card.tsx` (baru)
- `app/(app)/beranda/page.tsx` — card dipasang di bawah ringkasan saldo dan sesi

**docs (root)**: `docs/deeptalk-ai/cek-flow-mvp-151026.md` — P1 dan B1 diperbarui

## Keputusan

- **Endpoint status terpisah dan hanya membaca.** `GET /psikolog/persona` selalu membuat workspace. Bila dipakai di Beranda, setiap psikolog yang sekadar membuka dashboard akan terhitung "sudah mulai menyusun" di halaman Cakupan.
- **Tahapan:**
  - `unavailable`: belum ada kuesioner; card tidak tampil.
  - `not_started`, `questionnaire` (dengan progres pertanyaan wajib), `cases`, `draft`.
  - `review`: ada draft yang belum disetujui; mencakup evaluasi dan persetujuan.
  - `active` / `disabled`.
- **Card tidak tampil sama sekali** bila psikolog belum mendapat token AI (rollout `off`, v3 tanpa modul AI) atau kuesioner belum ada. Beranda tidak menampilkan error untuk fitur yang belum dibuka.

## Validasi

- Gateway:
  - `lint` 0 error, `typecheck` bersih, `test` 263 lulus, `build` ok.
  - E2E `phase4-5` lulus. Pemeriksaan baru:
    - `not_started` tanpa membuat workspace;
    - `cases` setelah kuesioner lengkap;
    - `draft`;
    - `review`;
    - `active` dengan nama pendekatan.
- Dashboard: `tsc`, `lint`, `pnpm build` ok.
- Belum: tampilan card di browser. Dashboard butuh login psikolog ke v3, dan v3 hosting belum punya modul AI.

## Blocker

- [uji-client-ke-v3-dev](../blockers/uji-client-ke-v3-dev.md) — untuk melihat card dengan login nyata.

## Follow-up

- Commit perubahan dashboard: seluruh fitur Teman AI di `feat/ai-phase-5` masih di working tree.

## Rekap Status

**🟨 Sebagian.** 5 dari 6 item selesai dan terverifikasi. Yang belum: melihat card di browser dengan login psikolog nyata (terblokir v3 hosting).
