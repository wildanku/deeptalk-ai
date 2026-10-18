# Runbook: Gangguan Vertex AI / Agent

**Pemicu:** alert lonjakan `ai_turn outcome=error` (label `error`: `MODEL_TIMEOUT`, `MODEL_ERROR`, `TIMEOUT_TOTAL`, `TIMEOUT_IDLE`, `AGENT_UNAVAILABLE`), lonjakan `l2_verdict timed_out=true`, SLO waktu ke token pertama dilanggar, atau durasi giliran p95 > 30 dtk.

## Kode error giliran

| Kode | Asal | Artinya |
|---|---|---|
| `MODEL_TIMEOUT` | agent | Persona tidak memberi token pertama dalam `PERSONA_FIRST_TOKEN_TIMEOUT_MS` (sudah diulang sekali) atau melewati `PERSONA_TIMEOUT_MS`. Vertex lambat |
| `MODEL_ERROR` | agent | Panggilan persona gagal setelah retry (`MODEL_RETRY_ATTEMPTS`); 429/5xx |
| `TIMEOUT_TOTAL` | gateway | Stream giliran melewati `AGENT_TURN_TIMEOUT_MS` sebelum `done`. Normalnya agent memutus lebih dulu dengan `MODEL_TIMEOUT`; bila ini yang muncul, cek CPU/instance agent |
| `TIMEOUT_IDLE` | gateway | Tidak ada byte (termasuk ping 15 dtk) selama `AGENT_IDLE_TIMEOUT_MS`: koneksi ke agent putus diam-diam, instance agent mati/di-throttle |
| `AGENT_UNAVAILABLE` + `status` | gateway | 401/403 invoker IAM, 404 `AGENT_URL` salah, 5xx agent, tanpa status = tidak terjangkau / ID token |

Tahap yang lambat terlihat di log agent `turn timing` (`l2_ms`, `persona_first_token_ms`, `persona_ms`, `persona_retried`, `cards_ms`, `cards_timed_out`) dan metrik `agent_turn_*`; di gateway `ai_turn` membawa `router_ms`, `context_ms`, `agent_first_event_ms`.

## Perilaku gagal tertutup (02 §7.2)

- Agent/Vertex tidak tersedia → pesan pengguna tetap tersimpan, pengguna menerima pemberitahuan gangguan **dengan kontak bantuan**, dan bisa mengirim ulang.
- L1 tetap berjalan di gateway: pesan krisis tetap menerima protokol.
- L2 timeout → giliran diperlakukan `elevated` (lebih hati-hati, tidak ada tawaran routine/consent).

## Langkah

1. **Lingkup:** dashboard monitoring → rasio error dan timeout L2 per menit. Satu instance atau semua? Model tertentu (`ai_turn.model`)?
2. **Status Google Cloud:** status.cloud.google.com → Gemini Enterprise Agent Platform (Vertex AI), region **`us`** (model `gemini-4-argon`); Cloud Run agent sendiri di `asia-southeast2`. Jangan memindahkan lokasi model ke `global`/`eu` sebagai jalan pintas saat gangguan: agent menolaknya di production, dan lokasi pemrosesan adalah komitmen di consent (02 §9.1).
3. **Agent sehat?** Cloud Run `agent`: revisi terbaru, error 5xx, instance. Rilis baru dalam 1 jam terakhir → rollback trafik ke revisi sebelumnya (`gcloud run services update-traffic agent --to-revisions=<rev>=100`).
4. **Kuota/limit Agent Platform:** error 429 → minta kenaikan kuota atau pertimbangkan Priority PayGo di `us` (Argon tidak mendukung *fixed quota*); sementara turunkan beban (persentase rollout v3 `AI_ROLLOUT_PERCENT`).
5. **Timeout L2 tinggi tanpa error:** latensi model naik. Jangan menaikkan `SAFETY_TIMEOUT_MS` tanpa persetujuan lead (memperlama safety gate = token tertahan lebih lama).
6. **Giliran lambat tanpa error** (durasi p95 tinggi): lihat `turn timing`. `persona_first_token_ms` tinggi → Vertex; `l2_ms` = `SAFETY_TIMEOUT_MS` → L2 timeout; `context_ms`/`router_ms` tinggi di gateway → v3 atau router (direktori v3 gagal di-cache negatif 30 dtk, router punya `ROUTER_TIMEOUT_MS`). Giliran pertama setelah instance baru lambat → pastikan agent `--min-instances=1` dan log `model warm-up done` muncul. Pastikan gateway `--no-cpu-throttling` (giliran berjalan di background setelah socket putus).
7. **Gateway sendiri tidak sehat** (`/v1/health` gagal): cek Postgres AI dan Redis di VM Dokploy (status container, disk, koneksi dari Direct VPC egress) dan antrian Cloud Tasks (task menumpuk/gagal); rollback revisi gateway. Saat deploy/rollback, giliran yang berjalan diselesaikan (drain) dan client tersambung ulang otomatis.
8. **Komunikasi:** gangguan > 30 menit → banner di web/app **[pemilik komunikasi: Pak Novri]**.
9. Setelah pulih: cek tidak ada lonjakan `crisis_detected` tanpa `crisis_protocol_sent` selama gangguan.

## Latihan

Lokal: `e2e/run.sh resilience` (reload di tengah giliran → `pending_reply` lalu balasan tetap sampai; agent dimatikan di tengah sesi → gagal tertutup, protokol L1 tetap terkirim; restart semua gateway → timer sesi tetap benar). `staging`: matikan revisi agent sementara (scale ke 0) saat uji beban.
