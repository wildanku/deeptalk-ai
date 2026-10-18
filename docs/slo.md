# SLO DeepTalk AI

Target layanan dari 02 §12.2, cara mengukurnya, dan ke mana alert-nya pergi. Diimplementasikan sebagai kode di `infra/modules/monitoring` (log-based metrics, SLO, alert, dashboard). Semua angka berasal dari baris log `metric` gateway (`MetricsService`) — berisi enum, hitungan, dan durasi saja, tidak pernah isi percakapan atau ID pengguna.

| Indikator | Target | Sumber | Alert | Runbook |
|---|---|---|---|---|
| Ketersediaan gateway | 99,5% / 30 hari | Cloud Run `request_count` tanpa 5xx (SLO `availability`) + uptime check `/v1/health` | Burn rate > 10 dalam 1 jam; uptime gagal 2 menit | [gangguan-vertex-ai](runbooks/gangguan-vertex-ai.md) |
| Waktu ke token pertama (p95) | ≤ 4 detik | `ai_turn.first_token_ms` — diukur saat token pertama **ditampilkan** ke pengguna, setelah safety gate | p95 15 menit > 4.000 ms selama 10 menit | [gangguan-vertex-ai](runbooks/gangguan-vertex-ai.md) |
| Pesan krisis yang menerima protokol | 100% | `crisis_detected` vs `crisis_protocol_sent` (jalur sesi, gerbang consent/usia, kuota, butir keamanan cek diri) | Selisih > 0 dalam 10 menit (SEV-1) | [insiden-krisis](runbooks/insiden-krisis.md) |
| Tingkat `ai.error` | < 1% giliran | `ai_turn{outcome}` | Rasio error 15 menit > 1% selama 5 menit | [gangguan-vertex-ai](runbooks/gangguan-vertex-ai.md) |
| Durasi giliran (p95) | ≤ 30 detik | `ai_turn.duration_ms` (giliran `ok`, router + konteks + stream sampai `done`); tahap agent dari log `turn timing` (`agent_turn_*`) | p95 15 menit > 30.000 ms selama 10 menit | [gangguan-vertex-ai](runbooks/gangguan-vertex-ai.md) |
| Timeout L2 | < 0,5% giliran | `l2_verdict{timed_out}` | Rasio 15 menit > 0,5% selama 5 menit | [gangguan-vertex-ai](runbooks/gangguan-vertex-ai.md) |

Juga dikirim ke kanal on-call: **setiap kejadian `crisis`** (baris `CRITICAL` `ai_crisis`, dan webhook `ALERT_WEBHOOK_URL` dari gateway).

## Biaya (02 §12.3)

| Metrik | Isi |
|---|---|
| `ai_turn_input_tokens`, `ai_turn_output_tokens` | Token generate persona per giliran, per model (dari `usage` di event `done` agent) |
| `session_tokens_output` | Total token output per sesi selesai (`session_ended`); `ai_sessions.turns`, `tokens_input`, `tokens_output` menyimpan totalnya |
| Anggaran bulanan | `google_billing_budget`, notifikasi 50% / 90% / 100% |

Belum dihitung: token klasifikasi L2, keputusan kartu, router, ringkasan, dan draft handoff (panggilan Flash/Pro kecil di agent). Batas yang sudah ada: `MAX_OUTPUT_TOKENS` per giliran, `TURN_HISTORY_MESSAGES` (riwayat yang dikirim), kuota sesi bulanan, rate limit.

## Tracing

Satu span `ai.turn` per giliran di gateway; permintaan HTTP gateway, panggilan ke agent dan v3 ikut di trace yang sama (W3C `traceparent`). Agent tidak mengekspor span (span ADK memuat prompt); log agent membawa field trace Cloud Logging sehingga tampil di trace gateway. Hanya atribut dalam allow-list yang diekspor, ID di path URL diganti `:id`, query string dibuang. Aktifkan dengan `TRACING_EXPORTER=otlp` (default endpoint OTLP Cloud Trace), sampel `TRACING_SAMPLE_RATIO`.

## Uji beban

`e2e/load.mjs` (lewat `e2e/run.sh load`) mengukur indikator yang sama dari sisi client: token pertama p50/p95/p99, waktu balasan, tingkat error, dan rasio krisis → protokol, dengan N pengguna bersamaan di dua instance gateway. Hasil lokal hanya membuktikan alat ukurnya dan menemukan masalah perilaku; angka SLO yang berlaku adalah hasil di `staging` dengan Gemini (target tahap rollout pertama: Q3).
