# Runbook DeepTalk AI

Prosedur untuk insiden di produksi (02 §12.4). Ditulis untuk on-call engineer dan on-call psikolog yang mungkin belum pernah menyentuh sistem ini. Setiap runbook wajib dilatih minimal sekali sebelum rilis publik (03 Phase 6).

| Runbook | Kapan dipakai | Pemilik |
|---|---|---|
| [insiden-krisis](insiden-krisis.md) | Alert `ai_crisis`, atau laporan pengguna dalam bahaya | On-call psikolog + engineer |
| [gangguan-vertex-ai](gangguan-vertex-ai.md) | Lonjakan `AGENT_UNAVAILABLE`, timeout L2, error model | On-call engineer |
| [respons-tidak-aman](respons-tidak-aman.md) | Laporan respons AI yang berbahaya, L3 sering mengganti respons | On-call psikolog + engineer |
| [kebocoran-data](kebocoran-data.md) | Dugaan data pribadi atau isi percakapan keluar dari sistem | Engineer + hukum + Pak Novri |
| [restore-postgres-ai](restore-postgres-ai.md) | Data rusak/hilang, VM hilang, atau uji restore berkala | On-call engineer |
| [on-call](on-call.md) | Pedoman umum: kanal, eskalasi, catatan insiden | Semua |

Belum diputuskan dan menahan runbook menjadi final: siapa on-call (Q12) dan kebijakan tindak lanjut kejadian krisis (Q5). Bagian yang menunggu keputusan ditandai **[Q5]** / **[Q12]**.

## Aturan untuk semua runbook

- **Isi percakapan tidak dibuka** dalam penanganan insiden, kecuali kebijakan Q5 dan izin pengguna mengizinkannya. Alert, log, trace, dan metrik memang tidak memuatnya.
- Jangan menyalin ID pengguna ke kanal chat umum; pakai ID sesi atau ID kejadian.
- Setiap insiden dicatat (template di [on-call](on-call.md)) dan ditinjau setelahnya tanpa mencari kesalahan orang.
