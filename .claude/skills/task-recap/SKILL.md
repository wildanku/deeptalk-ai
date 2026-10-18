---
name: task-recap
description: Alur wajib untuk mendokumentasikan setiap task di repo deeptalk-ai — daftar pekerjaan di docs/tasks/YYYYMMDD-<nama-task>.md, penandaan selesai/belum di akhir, dan pencatatan blocker di docs/blockers/<nama-blocker>.md. Muat di awal setiap task yang mengubah kode, konfigurasi, dependensi, skema, infrastruktur, atau dokumen; juga saat diminta "catat task", "recap", "dokumentasikan pekerjaan", "tulis blocker", atau /task-recap.
metadata:
  type: project
---

# Task Recap & Blocker (deeptalk-ai)

`docs/tasks/` adalah riwayat implementasi repo ini. `docs/blockers/` adalah register hal yang menghalangi pekerjaan. Keduanya ditulis untuk engineer berikutnya (manusia atau agent) yang melanjutkan pekerjaan tanpa konteks sesi ini.

## Alur

### 1. Sebelum mulai

- Baca 3–5 recap terbaru di `docs/tasks/` yang menyentuh area yang sama, dan [docs/blockers/README.md](../../../docs/blockers/README.md). Bila task ini terblokir oleh blocker `OPEN`, sampaikan ke pengguna sebelum mengerjakan.
- Tentukan phase terkait di `docs/03-phase.md` (bila ada).

### 2. Daftar pekerjaan → buat file task

Pecah task menjadi item konkret yang bisa diverifikasi (bukan "kerjakan fitur X", tetapi "tambah `AiAuthGuard` yang memverifikasi `aud`/`exp`/`kid`"). Lalu **langsung** buat file recap dengan semua item `[ ]`, sebelum mulai mengubah kode.

Nama file:

```text
docs/tasks/YYYYMMDD-<nama-task>.md
```

- `YYYYMMDD` = tanggal hari ini (zona waktu Asia/Jakarta).
- `<nama-task>` = kebab-case huruf kecil, singkat dan spesifik: `20261008-gateway-scaffold.md`, `20261009-jwks-token-verification.md`.
- Jangan menimpa recap lama. Pekerjaan lanjutan di hari yang sama → sufiks bermakna (`-follow-up`, `-fix-reconnect`). Pekerjaan lanjutan di hari lain → file baru yang merujuk recap sebelumnya.

### 3. Selama mengerjakan

- Centang item begitu selesai **dan** terverifikasi.
- Item baru yang muncul di tengah jalan ditambahkan ke daftar (jangan dihilangkan dari catatan).
- Item yang dibatalkan tetap tercantum, dicoret: `- [ ] ~~item~~ — dibatalkan: <alasan>`.

### 4. Di akhir task — tandai dan rekap

- Periksa setiap item satu per satu:
  - `[x]` hanya bila selesai **dan** ada bukti (perintah dijalankan, hasil dicek, file ada).
  - `[ ]` bila belum, dengan alasan singkat di belakangnya: `— belum: <alasan>` atau `— terblokir: [<nama-blocker>](../blockers/<nama-blocker>.md)`.
- Pekerjaan akun eksternal, infrastruktur, deployment, migrasi, dan evaluasi safety tetap `[ ]` sampai buktinya tersedia.
- Isi bagian **Rekap Status** di akhir file.

### 5. Blocker

**Blocker** = sesuatu yang menghalangi item selesai dan tidak bisa diselesaikan agent sendiri: keputusan (mis. Q1–Q12 di 01 §6), akses/kredensial, konten dari psikolog, pekerjaan repo/tim lain, verifikasi eksternal. Pekerjaan sisa yang bisa dilanjutkan kapan saja bukan blocker → tulis di **Follow-up**.

Untuk setiap blocker:

1. Cek `docs/blockers/README.md`. Bila sudah ada blocker yang sama, **perbarui** filenya (tambah entri di *Riwayat*, tautkan task baru) — jangan membuat duplikat.
2. Bila belum ada, buat `docs/blockers/<nama-blocker>.md` (kebab-case, menamai masalahnya, bukan task-nya: `gemini-regional-endpoint.md`, `persona-gelombang-pertama-q1.md`).
3. Tambahkan baris di tabel register `docs/blockers/README.md`.
4. Tautkan dari bagian **Blocker** di recap task.
5. Saat blocker terselesaikan: ubah status ke `RESOLVED`, isi *Penyelesaian*, perbarui tabel register. File tidak dihapus.

### 6. Phase

Bila item di `docs/03-phase.md` berubah status, perbarui checkbox-nya dan legenda judul phase (⬜ Belum mulai · 🟦 Berjalan · 🟨 Sebagian · ✅ Selesai · ⛔ Terblokir).

### 7. Serahkan ke pengguna

Di pesan penutup, sebutkan path recap, ringkasan Rekap Status, dan blocker baru/terbuka. Task belum selesai sebelum recap ditulis dan checklist-nya jujur.

## Larangan

- Tidak ada rahasia (kunci, token, password, DSN berkredensial, isi `.env`) di recap maupun blocker.
- Tidak ada isi percakapan pengguna, data pribadi pengguna, atau contoh pesan krisis nyata. Gunakan contoh sintetis bila perlu.
- Jangan mencentang sesuatu yang tidak diverifikasi demi membuat task terlihat selesai.

## Template recap task

```md
# <Judul task>

**Tanggal:** YYYY-MM-DD
**Phase:** Phase N — <nama> ([03-phase.md](../03-phase.md)) | —
**Komponen:** gateway | agent | content | infra | docs | <repo lain>
**Recap terkait:** [YYYYMMDD-<nama>.md](YYYYMMDD-<nama>.md) | —

## Tujuan

Apa yang ingin dicapai task ini dan kenapa.

## Daftar Pekerjaan

- [x] Item konkret yang selesai dan terverifikasi
- [x] Item konkret yang selesai dan terverifikasi
- [ ] Item yang belum — belum: <alasan>
- [ ] Item yang terblokir — terblokir: [<nama-blocker>](../blockers/<nama-blocker>.md)

## File yang Diubah

- `path/ke/file` — kenapa diubah.
- `../deeptalk-api-v3/path/ke/file` — perubahan lintas repo (rujuk recap di repo tersebut).

## Keputusan

- Keputusan yang diambil selama task beserta alasannya (hapus bagian ini bila tidak ada).

## Validasi

- [x] `pnpm run test` (gateway) — 42 passed.
- [ ] Uji fan-out dua instance di `dev` — belum: lingkungan `dev` belum ada.

## Blocker

- [<nama-blocker>](../blockers/<nama-blocker>.md) — ringkasan satu kalimat. | Tidak ada.

## Follow-up

- [ ] Pekerjaan sisa yang tidak terblokir.

## Rekap Status

**Status:** ✅ Selesai | 🟨 Sebagian | ⛔ Terblokir
**Progres:** X/Y item selesai

| Belum selesai | Alasan |
|---|---|
| <item> | <belum: …/terblokir: …> |
```

Aturan status: ✅ bila semua item `[x]`; ⛔ bila ada item yang tertahan blocker `OPEN`; selain itu 🟨.

## Template blocker

```md
# <Judul blocker>

**Status:** `OPEN` | `RESOLVED`
**Dibuka:** YYYY-MM-DD · **Diselesaikan:** YYYY-MM-DD | —
**Jenis:** keputusan | akses | konten-psikolog | lintas-repo | eksternal | teknis
**Pemilik penyelesaian:** <nama/peran, mis. Pak Novri, psikolog, Wildan>
**Memblokir:** <item/phase, mis. Phase 2 — protokol krisis>
**Muncul di task:** [YYYYMMDD-<nama-task>.md](../tasks/YYYYMMDD-<nama-task>.md)

## Masalah

Apa yang menghalangi, dalam 2–4 kalimat. Fakta, bukan asumsi.

## Dampak

Apa yang tidak bisa diselesaikan selama blocker ini terbuka.

## Yang sudah dicoba / diketahui

- …

## Yang dibutuhkan untuk lepas

- [ ] Keputusan/akses/konten konkret yang diperlukan, dari siapa.

## Opsi dan usulan

| Opsi | Konsekuensi |
|---|---|
| … | … |

**Usulan default:** …

## Riwayat

- YYYY-MM-DD — dibuka dari task <nama-task>.

## Penyelesaian

(Diisi saat `RESOLVED`: apa yang diputuskan/dilakukan, oleh siapa, dan task yang melanjutkan.)
```
