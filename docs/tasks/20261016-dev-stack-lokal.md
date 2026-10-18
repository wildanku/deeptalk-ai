# Satu Perintah untuk Stack Lokal Teman AI + Panduan Kuesioner Persona

**Tanggal:** 2026-10-16
**Phase:** pendukung uji lokal (UAT [cek-flow-mvp-151026 §4](../../../docs/deeptalk-ai/cek-flow-mvp-151026.md))
**Komponen:** scripts, `psikolog-deeptalk-dashboard`
**Terkait:** [20261015-uji-lokal-alur-psikolog](20261015-uji-lokal-alur-psikolog.md)

## Tujuan

1. Satu perintah untuk menjalankan agent + gateway, deeptalk-api-v3 (cabang AI), deeptalk-web-v2, dan psikolog-deeptalk-dashboard.
2. (Permintaan sebelumnya, 15 Okt) Halaman Teman AI → Persona saya di dashboard: grid 2/3 form + 1/3 panduan yang mengikuti field yang sedang fokus, dengan contoh jawaban profesional dan tampilan mobile.

## Daftar Pekerjaan

### Stack lokal
- [x] `scripts/dev-stack.sh up|down|restart|status|logs`: port tetap (agent 8000, v3 3100, gateway 8080, web 3000, dashboard 3001), cek health, log di `.dev/logs/`, `.dev/` diabaikan git
- [x] Prasyarat dicek: Postgres, Redis, lima `.env`, peringatan bila `SUPERADMIN_LOGOS_*` v3 masih penanda
- [x] v3 dibangun dari `feat/ai-phase-1` ke `.dev/v3-ai` (prisma generate, hapus `tsbuildinfo`, `nest build`); build ulang hanya bila commit cabang berubah; checkout v3 tidak dipindah
- [x] `down` mematikan seluruh pohon proses (watcher `nest --watch`/`next dev`/`uvicorn --reload`), bukan hanya listener port
- [x] Uji: `down` → tidak ada proses tersisa; `up` → kelima layanan sehat dalam ±12 dtk
- [x] `AGENT.md` (Perintah)

### Dashboard: panduan kuesioner persona
- [x] `features/teman-ai/persona-guide.ts`: tujuan, tips, dan contoh jawaban per pertanyaan kuesioner (9) dan per studi kasus (8), dengan fallback generik untuk ID baru
- [x] `components/teman-ai/persona-guide-panel.tsx`: varian `side` (panel sticky kanan) dan `inline` (mobile: di bawah field yang fokus, contoh pertama terlihat, tips dan contoh lain dilipat)
- [x] `persona-workspace.tsx`: `GuidedGrid` `lg:grid-cols-3` (form `lg:col-span-2`, panel `lg:sticky lg:top-8`) untuk kuesioner dan studi kasus; nomor pertanyaan; tombol simpan selebar layar di mobile; `aria-describedby` ke panduan
- [x] `tsc --noEmit` dan `eslint` bersih
- [ ] Cek visual di browser (desktop dan lebar mobile) — tidak dijalankan: akses browser ditolak di sesi ini; perlu dilihat Wildan
- [ ] Contoh jawaban ditinjau tim psikolog — teks panduan UI, bukan konten klinis, tetapi ikut memengaruhi jawaban psikolog

## File yang Diubah

**deeptalk-ai**
- `scripts/dev-stack.sh` (baru), `.gitignore` (`.dev/`), `AGENT.md`

**psikolog-deeptalk-dashboard**
- `features/teman-ai/persona-guide.ts` (baru)
- `components/teman-ai/persona-guide-panel.tsx` (baru)
- `components/teman-ai/persona-workspace.tsx`

## Keputusan

- **Skrip di repo deeptalk-ai**, karena root `logos-dev` bukan repo git; jalur repo lain dihitung relatif (`..`).
- **v3 tidak di-checkout ulang.** Build salinan cabang AI dipakai sampai `feat/ai-phase-1` di-merge ke `deploy/prod`; `V3_BRANCH`/`V3_DIR` bisa diganti lewat env.
- **Web dijalankan dengan `.env`-nya sendiri.** Saat ini `NEXT_PUBLIC_API_URL` web mengarah ke v3 live (tanpa modul AI), jadi Teman AI sisi pengguna belum muncul di web lokal. Mengarahkannya ke v3 lokal adalah keputusan terpisah (data pengguna lalu dari DB v3 lokal).
- **Contoh panduan hanya ilustrasi.** Nama pendekatan disarankan berupa pendekatan, bukan nama pribadi, supaya pengguna tetap tahu mereka berbicara dengan AI. Contoh studi kasus disertai pengingat bahwa jawaban contoh gaya disalin apa adanya ke Persona Card.

## Validasi

- `dev-stack.sh`: `bash -n` lulus. Run pertama memperlihatkan dua bug yang lalu diperbaiki: (1) PID shell perantara yang menahan stdout sehingga `up` yang di-pipe tidak selesai; (2) `listening()` di bawah `pipefail` menghentikan `down` setelah layanan pertama. Setelah perbaikan: `down` bersih, `up` sehat semua dalam 11,7 dtk.
- Log dashboard saat stack berjalan: `/api/ai/psikolog/me` dan `/api/ai/psikolog/persona/status` → 200 (login psikolog sungguhan berhasil mendapat token AI dari v3 lokal).

## Blocker

Tidak ada.

## Follow-up

- Cek visual halaman Persona saya di desktop dan mobile.
- Bila uji alur pengguna di web lokal dibutuhkan: arahkan web ke v3 lokal (`NEXT_PUBLIC_API_URL`, `AI_GATEWAY_URL`) atau tunggu modul AI v3 dirilis.

## Rekap Status

- **Selesai:** 10/12
- **Belum:** cek visual di browser; tinjauan contoh jawaban oleh tim psikolog
- **Status task:** 🟨 Sebagian — skrip teruji; UI panduan lulus typecheck/lint, belum dilihat di browser.
