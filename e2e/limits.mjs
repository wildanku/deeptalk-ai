import { A, B, Client, FAKE_V3, check, failures, secret, sleep, sql, stack, tokens as loadTokens } from './lib.mjs';
const tokens = loadTokens();

// --- Quota (limit 2, idle 8 s) ------------------------------------------------------------------
const q = new Client(A, tokens['itest-quota']); await q.ready();
let r = await q.turn('halo, hari ini cukup berat di kantor');
check('session 1 opened', r.end?.[0] === 'ai.done');
const ended1 = await q.waitFor('session.ended', () => true, 20000, r.mark).catch(() => null);
check('idle timer closes session 1 (reason idle)', ended1?.reason === 'idle', JSON.stringify(ended1));
check('quota counts 1 after session 1', ended1?.quota?.used === 1);

// Two devices start session 2 at the same moment → only one new session.
const q2 = new Client(B, tokens['itest-quota']); await q2.ready();
const [x, y] = await Promise.all([q.say('perangkat satu'), q2.say('perangkat dua')]);
await sleep(3000);
const used = Number(sql("select count(*) from ai_sessions where user_id='itest-quota' and counts_toward_quota"));
check('concurrent first messages create exactly one new session', used === 2, `sessions=${used}`);
check('second device gets TURN_IN_PROGRESS or joins, never a third session', [x.ack, y.ack].some((ack) => ack.ok), JSON.stringify([x.ack, y.ack]));
await q.waitFor('session.ended', () => true, 25000, x.mark).catch(() => null);

const before = q.mark();
const exhausted = await q.say('mau cerita lagi soal kerjaan');
check('quota exhausted → ack QUOTA_EXHAUSTED', exhausted.ack.ok === false && exhausted.ack.code === 'QUOTA_EXHAUSTED');
const qe = await q.waitFor('quota.exhausted', () => true, 5000, before).catch(() => null);
check('quota.exhausted is warm, offers alternatives, and carries help', qe && qe.alternatives.includes('psikolog') && qe.help.contacts.length > 0 && qe.message.length > 50);

r = await q.turn('aku pengen mati aja');
check('crisis with quota exhausted → protocol, not quota message', r.end?.[0] === 'safety.escalation' && !q.since(r.mark).some(([e]) => e === 'quota.exhausted'), JSON.stringify(q.since(r.mark).map(([e]) => e)));
const crisisRow = sql("select counts_toward_quota || ',' || max_risk_level from ai_sessions where user_id='itest-quota' and status <> 'ended'");
check('crisis session opened outside the quota', crisisRow === 'false,crisis', crisisRow);

// --- Active time: warning (10 s), limit (20 s), grace (3 s) ------------------------------------
const t = new Client(A, tokens['itest-crisis']); await t.ready();
await t.turn('aku mau cerita tentang pekerjaan');
await sleep(7000);
await t.turn('lanjut ya');
await sleep(7000);
r = await t.turn('masih ada lagi');
const warning = t.since(0).find(([e]) => e === 'session.warning');
check('session.warning sent around the threshold', Boolean(warning), JSON.stringify(t.since(0).map(([e]) => e)));
await sleep(7000);
r = await t.turn('satu lagi sebelum selesai');
const closing = await t.waitFor('session.closing', () => true, 5000, 0).catch(() => null);
check('session.closing when the active limit is reached', Boolean(closing));
const endedT = await t.waitFor('session.ended', (p) => p.reason === 'completed', 15000, 0).catch(() => null);
check('session closes after the grace period (reason completed)', Boolean(endedT));

// --- Memory summary after a session ends --------------------------------------------------------
await sleep(2000);
const summaries = Number(sql("select count(*) from ai_session_summaries where user_id in ('itest-quota','itest-crisis')"));
check('cross-session summaries stored after sessions end', summaries >= 2, `summaries=${summaries}`);
const plaintext = Number(sql("select count(*) from ai_session_summaries where position(convert_to('model lokal','UTF8') in summary_ciphertext) > 0"));
check('summaries are encrypted at rest', plaintext === 0);

[q, q2, t].forEach((c) => c.close());
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
