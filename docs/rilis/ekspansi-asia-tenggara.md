# Persiapan Ekspansi Asia Tenggara

**Status:** audit, belum ada keputusan negara (blocker [keputusan-phase-8-lanjutan](../blockers/keputusan-phase-8-lanjutan.md)).
**Dibuat:** 2026-10-14, task [Phase 8](../tasks/20261014-phase-8-pengembangan-lanjutan.md).

DeepTalk AI saat ini dirancang untuk Indonesia. Dokumen ini mendaftar setiap asumsi khusus Indonesia di kode, konten, dan infrastruktur, beserta yang perlu disiapkan per negara. Tujuannya agar keputusan negara pertama bisa langsung diterjemahkan ke pekerjaan, tanpa menebak di mana asumsi itu tersimpan.

Penyesuaian bahasa balasan chat bukan dukungan multi-negara atau lokalisasi. Pelatihan/fine-tuning khusus DeepTalk AI, konten klinis, safety, dan evaluasi tetap berfokus pada Bahasa Indonesia; bahasa lain belum divalidasi. Membangun dukungan multi-negara sebelum negara, regulasi, dan mitra krisis diputuskan berisiko menghasilkan abstraksi yang salah.

## Asumsi yang ada sekarang

| Area | Asumsi | Di mana | Sudah bisa dikonfigurasi? |
|---|---|---|---|
| Bahasa balasan chat agent | Mengikuti bahasa pesan pengguna; notice menyatakan basis pelatihan/fine-tuning khusus DeepTalk AI hanya Bahasa Indonesia dan bahasa lain berupa terjemahan/adaptasi | `agent/prompts/global/v2-draft.md` | Terbatas pada bahasa balasan; belum ada prompt atau konten per bahasa |
| Safety L1 | Frasa dan normalisasi slang bahasa Indonesia | konten `l1_phrases` (`content/l1-phrases/`), `gateway/src/safety/l1.ts` (klitik `-nya`, `-ku`, dll.) | Frasa: konten. Aturan klitik: kode khusus bahasa Indonesia |
| Safety L2/L3 | Klasifikasi dengan prompt bahasa Indonesia | `agent/prompts/safety/` | Tidak |
| Evaluasi safety | Studi kasus sintetis bahasa Indonesia; recall krisis 100% | `content/evals/`, `agent/evals/` | Set per bahasa harus dibuat ulang |
| Protokol krisis dan hotline | Kontak Indonesia; fallback engineering 112 | konten `protocol` (`content/protocols/`), `gateway/src/safety/fallback.ts` | Konten satu set global (`ref_id` `crisis`/`elevated`), belum per negara. Fallback hardcode |
| Zona waktu | `Asia/Jakarta` | `DEFAULT_TIMEZONE` (env), default kolom `ai_user_routines.timezone`, kuota bulanan `period_month` | Env dan per-routine ya; periode kuota dihitung di satu zona |
| Cek diri (Phase 8) | Tanggal lokal dari zona waktu perangkat; default `DEFAULT_TIMEZONE` | `gateway/src/instruments/` | Ya |
| Usia minimum | 18 tahun | `AI_MIN_AGE` (env, 13–21) | Ya, tetapi satu nilai untuk semua pengguna |
| Consent | Teks hukum Indonesia (UU PDP) | konten `consent_text` (`service`, `ai_training`) | Satu teks global, belum per yurisdiksi |
| Residensi data | `asia-southeast2` (Jakarta) | `infra/envs/*/main.tf`, 02 §9 | Per environment, bukan per pengguna |
| Model | `gemini-4-argon` lewat Gemini Enterprise Agent Platform di region `us` (Jakarta tidak punya endpoint Gemini) | `agent/app/config.py` (`GOOGLE_CLOUD_LOCATION`) | Per environment; production dikunci ke `us` |
| Direktori psikolog, booking, asesmen | Katalog v3 Indonesia, Rupiah | `deeptalk-api-v3` | Di luar repo ini |
| Copy client | Bahasa Indonesia, `id-ID` untuk tanggal | web `src/`, app `src/`, dashboard | Tidak ada lapisan i18n di web/app |
| Topik, routine, instrumen | Konten bahasa Indonesia | kind `topic`, `routine_item`, `instrument`, `knowledge` | Konten, tetapi tanpa dimensi bahasa/negara |

## Yang perlu diputuskan per negara

1. **Regulasi data.** Contoh: Malaysia PDPA 2010, Singapura PDPA 2012, Filipina DPA 2012, Thailand PDPA 2019, Vietnam Decree 13/2023. Untuk setiap negara perlu diketahui dasar pemrosesan data kesehatan, apakah data boleh disimpan di Jakarta atau harus di dalam negeri, kewajiban DPO, dan aturan notifikasi kebocoran. Ini menentukan apakah satu environment cukup atau perlu environment per negara.
2. **Regulasi layanan kesehatan digital.** Apakah teman bicara AI dengan arahan ke psikolog termasuk layanan kesehatan yang perlu izin, dan bagaimana aturan iklannya.
3. **Usia minimum dan consent orang tua.**
4. **Mitra krisis.** Hotline 24 jam yang terverifikasi (Q6) dan alur eskalasi on-call (Q5/Q12) dalam bahasa dan zona waktu negara itu.
5. **Bahasa.** Bahasa Melayu dekat dengan bahasa Indonesia, tetapi slang, frasa krisis, dan istilah klinisnya berbeda. Bahasa Inggris, Tagalog, Thai, dan Vietnam butuh set penuh.
6. **Psikolog.** Persona hanya bermakna bila ada psikolog berlisensi di negara itu yang menyusun dan menyetujuinya, dan tersedia untuk handoff.

## Pekerjaan engineering setelah negara diputuskan

Urutan yang disarankan. Tiap langkah melalui gerbang yang sama: konten disetujui psikolog setempat, evaluasi safety lulus dengan recall krisis 100% di bahasa itu.

1. Tambah dimensi `locale` pada konten berversi (`ai_content_versions`): protokol, frasa L1, consent, topik, routine, instrumen, dan persona. Fallback hanya ke locale yang sama; konten bahasa lain tidak boleh dipakai diam-diam. Perubahan skema aditif.
2. Locale pengguna dari v3 (klaim token baru atau endpoint internal) dan dari client. Simpan di `ai_user_state`.
3. Fallback engineering protokol (`fallback.ts`) per negara, dengan nomor darurat negara itu.
4. Aturan normalisasi L1 per bahasa (klitik dan slang berbeda).
5. Prompt agent per bahasa (`agent/prompts/<nama>/<versi>-<locale>.md`) dan set evaluasi safety per bahasa.
6. Periode kuota dan usia minimum per negara.
7. i18n di web dan app (saat ini semua copy dalam bahasa Indonesia).
8. Bila regulasi mewajibkan, environment terpisah di region negara itu (Terraform `infra/envs/<negara>-prod`).

## Yang tidak berubah

Arsitektur (gateway, agent, v3), aturan arah panggilan, enkripsi, dan prinsip "konten klinis hanya dari psikolog" berlaku sama di setiap negara.
