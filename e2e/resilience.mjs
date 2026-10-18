import { A, B, Client, FAKE_V3, check, failures, secret, sleep, sql, stack, tokens as loadTokens } from './lib.mjs';
const tokens = loadTokens();

// --- Reload mid-turn: the reply still arrives ---------------------------------------------------
// The browser drops its socket right after sending (a page refresh). The turn keeps running on
// the gateway; a new socket on the other instance gets `ai.done`, or history has the reply.
const m = new Client(A, tokens['itest-a']); await m.ready();
const { ack: sent } = await m.say('aku mau cerita soal kerjaan');
check('reload: ack carries the session id for the room URL', sent.ok && typeof sent.session_id === 'string', JSON.stringify(sent));
m.close();
const mid = await m.rest('/sessions/current');
const pending = mid.body?.data?.pending_reply;
check('reload: /sessions/current reports the reply in progress, by ID only', pending?.user_message_id === sent.message_id && typeof pending?.message_id === 'string' && !('content' in (pending ?? {})), JSON.stringify(pending));
const userRow = mid.body?.data?.messages?.find((x) => x.id === sent.message_id);
check('reload: the stored user message carries its client_message_id for a resend', typeof userRow?.client_message_id === 'string');
const m2 = new Client(B, tokens['itest-a']); await m2.ready();
const doneAfterReload = await m2.waitFor('ai.done', (p) => p.message_id === pending?.message_id, 20000).catch(() => null);
const after = await m2.rest('/sessions/current');
const storedReply = after.body?.data?.messages?.some((x) => x.id === pending?.message_id && x.role === 'assistant');
check('reload: the reply reaches the new socket or history', doneAfterReload !== null || storedReply, JSON.stringify(after.body?.data?.pending_reply));
check('reload: no reply in progress once it is stored', after.body?.data?.pending_reply === null);
m2.close();

// --- Agent down: fail closed ------------------------------------------------------------------
stack('stop-agent');
await sleep(1000);
const d = new Client(A, tokens['itest-down']); await d.ready();
let r = await d.turn('hari ini aku capek banget');
check('agent down: normal message → ai.error with help contacts', r.end?.[0] === 'ai.error' && r.end[1].help?.contacts?.length > 0 && r.end[1].help.url, JSON.stringify(r.end));
check('agent down: user message still stored', sql("select count(*) from ai_messages m join ai_sessions s on s.id=m.session_id where s.user_id='itest-down' and m.role='user'") === '1');
r = await d.turn('aku mau bunuh diri');
check('agent down: crisis message still gets the protocol through L1', r.end?.[0] === 'safety.escalation' && r.end[1].level === 'crisis', JSON.stringify(r.end));
d.close();
stack('agent');
await sleep(3000);

// --- Restart every gateway mid-session: timers survive -----------------------------------------
const b = new Client(A, tokens['itest-b']); await b.ready();
r = await b.turn('aku mau cerita sebentar');
check('session open before restart', r.end?.[0] === 'ai.done');
const sessionId = sql("select id from ai_sessions where user_id='itest-b' and status='active'");
b.close();
stack('gateways');
const b2 = new Client(B, tokens['itest-b']); await b2.ready();
const ended = await b2.waitFor('session.ended', () => true, 30000).catch(() => null);
check('after restarting all instances the idle timer still closes the session', ended?.reason === 'idle' && ended.session_id === sessionId, JSON.stringify(ended));
check('closed exactly once in the database', sql(`select status || ',' || end_reason from ai_sessions where id='${sessionId}'`) === 'ended,idle');
b2.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
