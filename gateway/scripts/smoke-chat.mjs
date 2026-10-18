#!/usr/bin/env node
// Phase 1 smoke test: one conversation turn across two gateway instances.
//
//   GATEWAY_A=https://a… GATEWAY_B=https://b… AI_TOKEN=<ai_access_token> node scripts/smoke-chat.mjs
//
// AI_TOKEN comes from deeptalk-api-v3 `POST /v2/user/ai/access`. Socket A sends; socket B (same
// user, other instance) must receive the same ack, tokens, and reply through the Redis adapter.
// Then the reply must be readable over REST from instance B. Prints no message content.
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

const { GATEWAY_A, GATEWAY_B = GATEWAY_A, AI_TOKEN } = process.env;
if (!GATEWAY_A || !AI_TOKEN) {
  console.error('Set GATEWAY_A, AI_TOKEN (and optionally GATEWAY_B).');
  process.exit(2);
}
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 60_000);

function connect(base, label) {
  const socket = io(`${base}/ai`, { transports: ['websocket'], auth: { token: AI_TOKEN }, reconnection: false });
  const seen = { label, ack: null, tokens: '', done: null, error: null };
  socket.on('message.ack', (payload) => (seen.ack = payload));
  socket.on('ai.token', (payload) => (seen.tokens += payload.delta));
  socket.on('ai.done', (payload) => (seen.done = payload));
  socket.on('ai.error', (payload) => (seen.error = payload));
  const ready = new Promise((resolve, reject) => {
    socket.once('session.state', resolve);
    socket.once('connect_error', reject);
    socket.once('disconnect', (reason) => reject(new Error(`${label} disconnected: ${reason}`)));
  });
  return { socket, seen, ready };
}

const until = (predicate) =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) return clearInterval(timer), resolve();
      if (Date.now() - started > TIMEOUT_MS) clearInterval(timer), reject(new Error('timed out'));
    }, 50);
  });

const a = connect(GATEWAY_A, 'A');
const b = connect(GATEWAY_B, 'B');
let failed = false;
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  failed ||= !ok;
};

try {
  await Promise.all([a.ready, b.ready]);
  const clientMessageId = randomUUID();
  const ack = await a.socket.timeout(10_000).emitWithAck('message.send', {
    client_message_id: clientMessageId,
    content: 'Halo, ini pesan uji smoke Phase 1.',
  });
  check('message.send acknowledged', ack.ok === true && ack.client_message_id === clientMessageId);
  await until(() => (a.seen.done || a.seen.error) && (b.seen.done || b.seen.error));
  check('no ai.error', !a.seen.error && !b.seen.error);
  check('ai.done on A', Boolean(a.seen.done));
  check('ai.done on B (other instance, same user)', Boolean(b.seen.done));
  check('B saw the same message.ack', b.seen.ack?.message_id === ack.message_id);
  check('tokens add up to the reply', a.seen.tokens.trim() === a.seen.done?.content.trim());
  check('A and B received identical replies', a.seen.done?.content === b.seen.done?.content);

  const response = await fetch(`${GATEWAY_B}/v1/sessions/current`, {
    headers: { authorization: `Bearer ${AI_TOKEN}` },
  });
  const body = await response.json();
  const messages = body.data?.messages ?? [];
  const reply = messages.find((message) => message.id === a.seen.done?.message_id);
  check('history over REST returns the stored reply', response.ok && reply?.content === a.seen.done?.content);
  check('history keeps the user message', messages.some((message) => message.id === ack.message_id));
} catch (error) {
  check(`run (${error.message})`, false);
} finally {
  a.socket.close();
  b.socket.close();
}
process.exit(failed ? 1 : 0);
