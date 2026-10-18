import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { execFileSync, execSync } from 'node:child_process';
const require = createRequire(new URL('../gateway/package.json', import.meta.url));
const { io } = require('socket.io-client');
import { readFileSync } from 'node:fs';
export const A = process.env.GATEWAY_A ?? 'http://localhost:18081';
export const B = process.env.GATEWAY_B ?? 'http://localhost:18082';
export const FAKE_V3 = process.env.FAKE_V3 ?? 'http://localhost:18300';
export const STATE = process.env.E2E_STATE;
export const tokens = () => JSON.parse(readFileSync(`${STATE}/tokens.json`, 'utf8'));
export const secret = (name) => readFileSync(`${STATE}/${name}`, 'utf8').trim();
// No shell: queries may contain JSON with double quotes.
export const sql = (query) => execFileSync('psql', [process.env.E2E_DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-tAc', query], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
export const stack = (what) => execSync(`${new URL('./stack.sh', import.meta.url).pathname} ${what}`, { stdio: 'inherit' });
export let failures = 0;
export function check(name, ok, detail = '') { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` — ${detail}` : ''}`); if (!ok) failures++; }
export class Client {
  constructor(base, token) {
    this.token = token; this.base = base; this.events = [];
    this.socket = io(`${base}/ai`, { transports: ['websocket'], auth: { token }, reconnection: false });
    this.socket.onAny((event, payload) => this.events.push([event, payload]));
  }
  ready() { return this.waitFor('session.state'); }
  waitFor(event, predicate = () => true, timeout = 20000, from = 0) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const t = setInterval(() => {
        const hit = this.events.slice(from).find(([e, p]) => e === event && predicate(p));
        if (hit) { clearInterval(t); resolve(hit[1]); }
        else if (Date.now() - started > timeout) { clearInterval(t); reject(new Error(`timeout waiting for ${event}`)); }
      }, 25);
    });
  }
  mark() { return this.events.length; }
  since(mark) { return this.events.slice(mark); }
  emit(event, payload) { return this.socket.timeout(15000).emitWithAck(event, payload); }
  async say(content) {
    const mark = this.mark();
    const ack = await this.emit('message.send', { client_message_id: randomUUID(), content });
    return { ack, mark };
  }
  async turn(content) {
    const { ack, mark } = await this.say(content);
    if (!ack.ok) return { ack, mark, end: null };
    const end = await Promise.race([
      this.waitFor('ai.done', () => true, 20000, mark).then((p) => ['ai.done', p]),
      this.waitFor('safety.escalation', (p) => p.level === 'crisis', 20000, mark).then((p) => ['safety.escalation', p]),
      this.waitFor('ai.error', () => true, 20000, mark).then((p) => ['ai.error', p]),
    ]);
    return { ack, mark, end };
  }
  async rest(path, init = {}) {
    const request = () => fetch(`${this.base}/v1${path}`, { ...init, headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
    // A keep-alive socket the server closed during a pause (e.g. while a script ran) resets the
    // next request; that request never reached the server, so one retry is safe.
    const res = await request().catch((error) => {
      if (error?.cause?.code === 'ECONNRESET') return request();
      throw error;
    });
    const text = await res.text();
    let body = null; try { body = JSON.parse(text); } catch {}
    return { status: res.status, body };
  }
  close() { this.socket.close(); }
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
