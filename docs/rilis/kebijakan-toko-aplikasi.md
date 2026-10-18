# Kebijakan Toko Aplikasi untuk Teman AI

**Ditinjau:** 2026-10-11 (engineering). Teks kebijakan berubah; baca ulang versi terbaru sebelum setiap submit, dan minta tinjauan hukum untuk bagian privasi.

Teman AI adalah fitur percakapan AI bertema kesehatan mental di `deeptalk-app-v2` (iOS/Android) dan web. Psikolog memakai `psikolog-app-v2` (hanya membaca ringkasan handoff; tidak ada AI di dalamnya).

## Apple App Store

| Aturan | Yang diminta | Status di Teman AI |
|---|---|---|
| 5.1.2(i) — data pribadi ke AI pihak ketiga (direvisi Nov 2025) | Beri tahu dengan jelas bahwa data dibagikan ke AI pihak ketiga, **sebutkan penyedianya**, dan minta izin eksplisit **sebelum** data pertama dikirim — bukan hanya di kebijakan privasi | ✅ Mekanisme: gerbang consent layanan menahan pesan pertama sampai pengguna setuju (teks berversi, persetujuan ulang bila berubah material). ⚠️ Teks consent final **wajib menyebut Google (Vertex AI / Gemini)** dan apa yang dilakukan model dengan data — masuk blocker hukum |
| 5.1.1 — persetujuan, minimisasi, penghapusan akun di dalam app | Consent untuk pengumpulan data; penghapusan akun bisa dimulai dari app | ✅ Consent layanan/pelatihan, "Persetujuan & data" (hapus riwayat), hapus akun di app (v3) ikut menghapus data AI (Phase 4) |
| 1.4.1 — aplikasi medis/kesehatan | Tidak boleh memberi diagnosis/saran medis yang bisa membahayakan; jelaskan keterbatasan | ✅ Label "AI" selalu tampil, "bukan psikolog", L3 mengganti respons yang menyebut obat/diagnosis, protokol krisis + kontak darurat. ⚠️ Kebijakan tindak lanjut krisis (Q5) |
| 1.2 / pelaporan konten | (Untuk konten yang tidak bisa diprediksi) cara melaporkan | ✅ "Laporkan respons" di setiap balasan AI |
| Usia (4.7.x, rating usia) | Rating usia sesuai; fitur untuk dewasa | ✅ Gerbang usia (`AI_MIN_AGE`, Q4); ⚠️ sesuaikan rating di App Store Connect setelah Q4 |
| Privacy Nutrition Label | Data yang dikumpulkan dan tujuannya | ⚠️ Perbarui: isi percakapan (fungsi app), tanggal lahir (verifikasi usia), diagnostik tanpa isi |

## Google Play

| Kebijakan | Yang diminta | Status |
|---|---|---|
| AI-Generated Content | Aplikasi generatif (chatbot) wajib punya pelaporan/penandaan konten AI yang menyinggung **di dalam app**, dan memakai laporan itu untuk moderasi | ✅ "Laporkan respons" (alasan + izin membaca respons), ditinjau reviewer klinis di dashboard; runbook [respons-tidak-aman](../runbooks/respons-tidak-aman.md) |
| Health apps / Health Content and Services | Deklarasi aplikasi kesehatan di Play Console, tidak menyesatkan, disclaimer bukan pengganti tenaga profesional | ✅ Disclaimer di UI; ⚠️ isi Health apps declaration form saat submit |
| User Data — prominent disclosure & consent | Pengungkapan di dalam app sebelum pengumpulan data sensitif, persetujuan afirmatif | ✅ Gerbang consent sebelum pesan pertama; ⚠️ teks final dari hukum |
| Data safety section | Deklarasi jenis data, tujuan, enkripsi saat transit, penghapusan | ⚠️ Perbarui: isi pesan, tanggal lahir; terenkripsi (TLS + KMS at rest); bisa dihapus (riwayat & akun) |
| Account deletion | Penghapusan akun dari app dan dari web | ✅ Sudah ada di v3/app; data AI ikut terhapus (feed + webhook, diuji E2E) |

## Sebelum submit

- [ ] Teks consent final menyebut Google Cloud (Gemini Enterprise Agent Platform / Vertex AI), lokasi penyimpanan data per tahap (Singapura untuk beta; Indonesia untuk production/rilis resmi), lokasi pemrosesan AI (**Amerika Serikat**, region `us`), dan tujuan — [teks-hukum-consent-privasi-dpia](../blockers/teks-hukum-consent-privasi-dpia.md)
- [ ] Rating usia dan gerbang usia sesuai keputusan Q4
- [ ] Privacy Nutrition Label (Apple) dan Data safety (Play) diperbarui
- [ ] Health apps declaration (Play)
- [ ] Catatan untuk reviewer: akun uji di allowlist rollout, cara memicu protokol krisis dengan frasa sintetis, lokasi tombol "Laporkan respons"

## Sumber

- [TechCrunch — Apple's new App Review Guidelines clamp down on apps sharing personal data with third-party AI (13 Nov 2025)](https://techcrunch.com/2025/11/13/apples-new-app-review-guidelines-clamp-down-on-apps-sharing-personal-data-with-third-party-ai)
- [9to5Google — Google Play generative AI policy (Okt 2023)](https://9to5google.com/2023/10/25/google-play-gen-ai-policy/)
- [MediaNama — Google Play content reporting policy for AI apps](https://www.medianama.com/2023/10/223-google-play-content-reporting-policy-ai-apps/)
