# Materi Komunikasi Teman AI

Prinsip "Jujur dalam klaim" (03 Phase 7, Konsep §6): setiap kalimat tentang Teman AI harus bisa ditunjukkan buktinya. Draf di bawah untuk Pak Novri dan tim pemasaran; klaim terkait privasi dan data menunggu teks hukum final ([blocker](../blockers/teks-hukum-consent-privasi-dpia.md)).

## Klaim yang boleh dipakai

| Klaim | Bukti |
|---|---|
| Teman AI adalah teman bicara berbasis AI, **bukan psikolog** | Label "AI" di setiap balasan; aturan global agent |
| Pendekatannya disusun dan disetujui psikolog DeepTalk | Kurasi persona di dashboard; persona aktif hanya setelah disetujui psikolognya dan lolos evaluasi |
| Setiap tanda bahaya dialihkan ke bantuan darurat | Safety tiga lapis; protokol krisis dari psikolog; SLO 100% krisis → protokol |
| Tidak memberi diagnosis atau saran obat | L3 mengganti respons yang menyebut obat/diagnosis |
| Bisa mengarahkan ke asesmen dan psikolog DeepTalk | Kartu asesmen dan handoff; indikator Dampak |
| Ringkasan untuk psikolog hanya dibagikan bila kamu menyetujuinya | Alur handoff: pengguna menghapus bagian dan menyetujui |
| Percakapan disimpan terenkripsi dan bisa kamu hapus | Enkripsi KMS; hapus riwayat; hapus akun ikut menghapus data AI |
| Gratis, dengan kuota sesi per bulan | Kuota bulanan (angka final sesuai konfigurasi) |

## Klaim yang tidak boleh dipakai

| Klaim | Alasan |
|---|---|
| "Dilatih dengan ribuan data percakapan kesehatan mental" / "AI yang dilatih khusus" | Tidak benar: model umum (Gemini) dengan instruksi dan materi dari psikolog. Sudah dihapus dari web (Phase 7) |
| "100% privat" / "100% aman" | Percakapan diproses penyedia model AI; tidak ada sistem yang 100% |
| "Menggantikan psikolog" / "terapi" / "diagnosis" | Bertentangan dengan peran produk dan kebijakan toko aplikasi |
| "Memahami perasaanmu dengan presisi tinggi" / angka akurasi | Tidak ada pengukuran yang mendukung |
| "Persona X adalah psikolog X" | Persona adalah AI dengan pendekatan psikolog itu, bukan orangnya |
| Menyebut hotline sebelum terverifikasi (Q6) | Kontak darurat harus diverifikasi psikolog |

## Draf per tahap

**Internal (pesan ke tim dan psikolog):**
> Teman AI sekarang bisa dicoba oleh tim DeepTalk. Ini AI, bukan psikolog: pendekatannya disusun psikolog kita, dan setiap tanda bahaya dialihkan ke bantuan darurat. Bantu kami dengan tombol "Laporkan respons" bila ada balasan yang tidak pantas.

**Beta (undangan ke pengguna terpilih):**
> Kamu diundang mencoba Teman AI, teman bicara berbasis AI dari DeepTalk. Teman AI bukan psikolog — pendekatannya disusun bersama psikolog DeepTalk, dan bila kamu butuh lebih, ia bisa mengarahkanmu ke asesmen atau psikolog. Kamu bisa menghapus riwayat percakapanmu kapan saja.

**GA (pengumuman):**
> Kenalkan Teman AI: teman bicara berbasis AI yang siap mendengarkan kapan saja, dengan pendekatan yang disusun psikolog DeepTalk. Teman AI bukan pengganti psikolog — saat kamu butuh lebih, ia membantumu ke asesmen atau sesi dengan psikolog. Dalam keadaan darurat, Teman AI selalu menunjukkan bantuan darurat.

Setiap materi mencantumkan: "Teman AI adalah AI dan bisa keliru. Bukan layanan darurat — dalam keadaan darurat hubungi 112." (nomor final: Q6).

## Copy situs yang diubah (Phase 7)

`deeptalk-web-v2`: `home-hero.tsx`, `hero-section.tsx`, `approach-section.tsx` (judul, paragraf, dua butir fitur), `about/page.tsx` — klaim "dilatih khusus/ribuan data", "presisi tinggi", "100% privat" diganti pernyataan di atas. Perlu persetujuan Pak Novri sebelum rilis.
