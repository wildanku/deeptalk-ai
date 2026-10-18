# Pedoman On-call

## Siapa

- **On-call engineer** dan **on-call psikolog**, satu pasang per periode — **[Q12]** belum ditunjuk.
- Eskalasi: lead engineering → Pak Novri. Untuk data pribadi: konsultan hukum (UU PDP).

## Kanal

| Sinyal | Sumber | Ke mana |
|---|---|---|
| Kejadian `crisis` | Log `CRITICAL` `ai_crisis` + `ALERT_WEBHOOK_URL` | Kanal on-call (engineer + psikolog) |
| Pelanggaran SLO, lonjakan timeout L2 | Alert Cloud Monitoring (`infra/modules/monitoring`) | Kanal on-call engineer |
| Anggaran | Budget alert GCP | Engineer + Pak Novri |
| Laporan respons AI | Dashboard → Tinjauan keamanan | Reviewer klinis (harian) |

## Alat

- Cloud Logging: filter `jsonPayload.metric` untuk metrik, `jsonPayload.alert="ai_crisis"` untuk krisis.
- Cloud Trace: span `ai.turn` per giliran (tanpa isi), log agent tertaut ke trace yang sama.
- Dashboard psikolog: Tinjauan keamanan (kejadian + laporan respons), Konten klinis, Persona.
- Darurat: menonaktifkan persona (dashboard, berlaku di giliran berikutnya); mematikan Teman AI untuk semua pengguna lewat v3 `AI_ROLLOUT_MODE=off` (pengguna yang sudah tersambung berhenti paling lambat 15 menit kemudian, saat token AI kedaluwarsa).

## Catatan insiden (template)

```
Judul:
Mulai / selesai (WIB):
Dampak (berapa pengguna/sesi, tanpa ID pengguna):
Deteksi (alert apa, kapan):
Kronologi:
Tindakan:
Akar masalah:
Tindak lanjut (pemilik, tenggat):
```
