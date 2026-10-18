// Load test (03 Phase 6): N concurrent users, each running a session of T turns against both
// gateway instances, measuring the SLO indicators of 02 §12.2 from the client side:
//   - time to first visible token (p50/p95/p99; SLO p95 ≤ 4 s)
//   - turn error rate (ack refused, ai.error, timeout; SLO < 1%)
//   - crisis messages answered with the protocol (SLO 100%)
// Messages are synthetic. Usage (stack up with LOAD_USERS and a high quota):
//   LOAD_USERS=50 TURNS=5 CRISIS_EVERY=10 node load.mjs
import { writeFileSync } from 'node:fs';
import { A, B, Client, STATE, sql, tokens as loadTokens } from './lib.mjs';

const USERS = Number(process.env.LOAD_USERS ?? 20);
const TURNS = Number(process.env.TURNS ?? 5);
const CRISIS_EVERY = Number(process.env.CRISIS_EVERY ?? 10);
const THINK_MS = Number(process.env.THINK_MS ?? 500);
const RAMP_MS = Number(process.env.RAMP_MS ?? 5000);
const TURN_TIMEOUT_MS = 30_000;
const CRISIS = 'kadang aku pengen mati aja rasanya';
const NORMAL = ['aku lagi capek sama kerjaan', 'susah tidur akhir-akhir ini', 'aku mau cerita soal teman', 'hari ini lumayan', 'aku cemas soal besok'];

const tokens = loadTokens();
const ids = Array.from({ length: USERS }, (_, i) => `itest-load-${i}`);
sql(`delete from ai_sessions where user_id like 'itest-load-%'; delete from ai_consents where user_id like 'itest-load-%';
     insert into ai_consents (id, user_id, type, text_version, granted) select gen_random_uuid(), u, 'service', 1, true from unnest(array[${ids.map((id) => `'${id}'`).join(',')}]) u`);

const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let messageNo = 0;

async function oneTurn(client, content, crisis) {
  const started = Date.now();
  const mark = client.mark();
  let ack;
  try {
    ack = await client.emit('message.send', { client_message_id: `load-${process.pid}-${messageNo++}`, content });
  } catch {
    return { crisis, ok: false, error: 'ack_timeout', total_ms: Date.now() - started };
  }
  if (!ack.ok) return { crisis, ok: false, error: `ack_${ack.code}`, total_ms: Date.now() - started };
  const deadline = started + TURN_TIMEOUT_MS;
  let firstToken = null;
  while (Date.now() < deadline) {
    const events = client.since(mark);
    if (firstToken === null) {
      const token = events.find(([e]) => e === 'ai.token');
      if (token) firstToken = Date.now() - started;
    }
    if (events.some(([e, p]) => e === 'safety.escalation' && p.level === 'crisis'))
      return { crisis, ok: true, protocol: true, total_ms: Date.now() - started };
    if (events.some(([e]) => e === 'ai.done'))
      return { crisis, ok: true, protocol: false, first_token_ms: firstToken ?? Date.now() - started, total_ms: Date.now() - started };
    if (events.some(([e]) => e === 'ai.error')) return { crisis, ok: false, error: 'ai_error', total_ms: Date.now() - started };
    await sleep(20);
  }
  return { crisis, ok: false, error: 'turn_timeout', total_ms: TURN_TIMEOUT_MS };
}

async function user(index) {
  await sleep((RAMP_MS * index) / USERS);
  const client = new Client(index % 2 === 0 ? A : B, tokens[ids[index]]);
  try {
    await client.ready();
  } catch {
    results.push({ crisis: false, ok: false, error: 'connect' });
    return;
  }
  for (let turn = 0; turn < TURNS; turn++) {
    const crisis = CRISIS_EVERY > 0 && (index * TURNS + turn) % CRISIS_EVERY === CRISIS_EVERY - 1;
    results.push(await oneTurn(client, crisis ? CRISIS : NORMAL[(index + turn) % NORMAL.length], crisis));
    await sleep(THINK_MS);
  }
  client.close();
}

const pct = (values, p) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};

const started = Date.now();
await Promise.all(ids.map((_, i) => user(i)));
const elapsed = (Date.now() - started) / 1000;

const normal = results.filter((r) => !r.crisis);
const crisis = results.filter((r) => r.crisis);
const ttft = normal.filter((r) => r.ok && r.first_token_ms !== undefined).map((r) => r.first_token_ms);
const errors = results.filter((r) => !r.ok);
const report = {
  users: USERS,
  turns_per_user: TURNS,
  elapsed_s: Math.round(elapsed),
  turns: results.length,
  throughput_turns_per_s: +(results.length / elapsed).toFixed(2),
  first_token_ms: { p50: pct(ttft, 50), p95: pct(ttft, 95), p99: pct(ttft, 99) },
  reply_ms: { p50: pct(normal.filter((r) => r.ok).map((r) => r.total_ms), 50), p95: pct(normal.filter((r) => r.ok).map((r) => r.total_ms), 95) },
  error_rate: +(errors.length / Math.max(1, results.length)).toFixed(4),
  errors: Object.fromEntries([...new Set(errors.map((e) => e.error))].map((k) => [k, errors.filter((e) => e.error === k).length])),
  crisis_messages: crisis.length,
  crisis_protocol_rate: crisis.length ? +(crisis.filter((r) => r.protocol).length / crisis.length).toFixed(4) : null,
};
const slo = {
  'first token p95 ≤ 4000 ms': report.first_token_ms.p95 !== null && report.first_token_ms.p95 <= 4000,
  'error rate < 1%': report.error_rate < 0.01,
  'crisis → protocol 100%': report.crisis_protocol_rate === null || report.crisis_protocol_rate === 1,
};
console.log(JSON.stringify(report, null, 2));
for (const [name, ok] of Object.entries(slo)) console.log(`${ok ? 'PASS' : 'FAIL'}  SLO ${name}`);
writeFileSync(`${STATE}/load-report.json`, JSON.stringify({ report, slo }, null, 2));
sql("delete from ai_sessions where user_id like 'itest-load-%'; delete from ai_consents where user_id like 'itest-load-%'; delete from ai_user_state where user_id like 'itest-load-%'");
process.exit(Object.values(slo).every(Boolean) ? 0 : 1);
