# prompts/

Aturan global yang berlaku untuk semua persona (02 §7.3, lapis 1): identitas AI, larangan diagnosis dan saran obat, batas topik, cara merujuk.

- Prompt global aktif: `global-v2-draft`. Balasan persona mengikuti bahasa pengguna dan memberi notice saat bahasa selain Indonesia pertama kali digunakan dalam percakapan.
- Prompt router aktif: `router-v1-draft`. Alasan pemilihan pendekatan mengikuti locale web yang dipilih (Indonesia atau English); istilah budaya yang tidak pasti dipertahankan, bukan diterka terjemahannya.
- Pelatihan/fine-tuning khusus DeepTalk AI dan konten klinis masih berbahasa Indonesia. Balasan dalam bahasa lain adalah terjemahan/adaptasi dan tidak berarti safety atau materi klinis sudah dilokalkan atau divalidasi dalam bahasa tersebut.
- Satu file per versi. Versi tidak pernah diubah setelah dipakai di `prod`; perubahan = versi baru.
- Versi aktif dikirim balik di event `done` (`prompt_version`) dan disimpan per pesan oleh gateway.
- Isi aturan global ditinjau psikolog sebelum dipakai. Draft wajib bertanda `DRAFT` di judulnya.
- Persona Card, protokol krisis, dan pengetahuan klinis **bukan** di sini: itu konten berversi di database gateway (`ai_content_versions`).
