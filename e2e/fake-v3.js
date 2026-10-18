// Local integration only: deeptalk-api-v3's real AiTokenService (from its dist build) for tokens
// and JWKS, plus deterministic stand-ins for the public directory/catalog and internal AI
// endpoints. Records notifications so the test can assert on them.
const { generateKeyPairSync } = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const V3 = process.argv[2];
const SERVICE_TOKEN = process.argv[3];
const { AiTokenService } = require(path.join(V3, 'dist/modules/ai/ai-token.service.js'));
const key = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const issuer = new AiTokenService({ get: (k) => ({ AI_JWT_PRIVATE_KEY: key, AI_JWT_KID: 'dev-1', AI_GATEWAY_PUBLIC_URL: 'http://localhost:18081', AI_JWT_TTL_SECONDS: 900 })[k] });
const tokens = {};
const USERS = ['itest-a', 'itest-b', 'itest-quota', 'itest-crisis', 'itest-down',
  'itest-p4-a', 'itest-p4-minor', 'itest-p4-nodob', 'itest-p4-del', 'itest-p4-pull', 'itest-p4-from', 'itest-p4-to',
  'itest-p8-a', 'itest-p8-noc', 'itest-p8-del', 'itest-p8-from', 'itest-p8-to',
  'itest-p9-a', 'itest-p9-b', 'itest-p9-crisis'];
// Load test users (`LOAD_USERS=N`): itest-load-0 … itest-load-(N-1).
for (let i = 0; i < Number(process.env.LOAD_USERS ?? 0); i++) USERS.push(`itest-load-${i}`);
for (const user of USERS) tokens[user] = issuer.issue(user, 'user').ai_access_token;
for (const psikolog of ['PSY-TEST', 'PSY-P5', 'PSY-REV', 'PSY-REV2', 'PSY-P9', 'PSY-DATA']) tokens[psikolog] = issuer.issue(psikolog, 'psikolog').ai_access_token;
// Phase 4: birth dates per user (null = never filled in), editable through /test/users/:id/birth_date.
const birthDates = { 'itest-p4-minor': '2012-01-01', 'itest-p4-nodob': null };
// Phase 4: account events feed (stand-in for deleted_data), appended through /test/account-events.
const accountEvents = [];
let nextEventId = 1000;
fs.writeFileSync(path.join(process.env.E2E_STATE, 'tokens.json'), JSON.stringify(tokens, null, 2));
const notifications = [];
const ok = (res, data) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); };
const nf = (res) => { res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ success: false, message: 'not found' })); };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (p === '/v2/.well-known/ai-jwks.json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(issuer.jwks())); }
  if (p === '/test/notifications') { res.writeHead(200); return res.end(JSON.stringify(notifications)); }
  if (p === '/test/account-events' && req.method === 'POST') {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => { const e = JSON.parse(body); const event = { id: String(nextEventId++), kind: e.kind, user_id: e.user_id, target_user_id: e.target_user_id ?? null, occurred_at: new Date().toISOString() }; accountEvents.push(event); res.writeHead(200); res.end(JSON.stringify(event)); }); return;
  }
  let t;
  if ((t = p.match(/^\/test\/users\/([^/]+)\/birth_date$/)) && req.method === 'POST') {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => { birthDates[t[1]] = JSON.parse(body).birth_date; res.writeHead(200); res.end('{}'); }); return;
  }
  if (p === '/v2/user/find/psikolog/PSY-TEST') return ok(res, { psikolog_id: 'PSY-TEST', profile_unavailable: false, psikolog: { name: 'Psikolog Uji', avatar: null, specialists: [{ name: 'Kecemasan' }], year_experience: 5 } });
  if (p === '/v2/user/find/assessments/ASM-TEST') return ok(res, { id: 'ASM-TEST', name: 'Tes Uji Kecemasan', is_free: true, description: null, category: { name: 'Kecemasan' } });
  if (p.startsWith('/v2/user/find/')) return nf(res);
  // Dashboard BFF check: a psikolog "session" `psy-session-<ID>` gets that psikolog's AI token.
  if (p === '/v2/psikolog/ai/access' && req.method === 'POST') {
    const m = /^Bearer psy-session-(PSY-[A-Z0-9-]+)$/.exec(req.headers.authorization ?? '');
    if (!m) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ success: false, message: 'Unauthorized' })); }
    return ok(res, issuer.issue(m[1], 'psikolog'));
  }
  if (p.startsWith('/v2/internal/ai/')) {
    if (req.headers['x-ai-service-token'] !== SERVICE_TOKEN) { res.writeHead(401); return res.end('{}'); }
    let m;
    if ((m = p.match(/^\/v2\/internal\/ai\/users\/([^/]+)$/))) return ok(res, { nickname: 'Rani', birth_date: m[1] in birthDates ? birthDates[m[1]] : '1999-04-01', gender: 'female' });
    if (p === '/v2/internal/ai/account-events') {
      const after = BigInt(url.searchParams.get('after_id') ?? '0'); const limit = Number(url.searchParams.get('limit') ?? 200);
      return ok(res, { events: accountEvents.filter((e) => BigInt(e.id) > after).slice(0, limit) });
    }
    if (p.match(/^\/v2\/internal\/ai\/users\/[^/]+\/assessments$/)) return ok(res, [{ name: 'Tes Uji Kecemasan', completed_at: '2026-10-01', result_category: 'Sedang' }]);
    if ((m = p.match(/^\/v2\/internal\/ai\/bookings\/([^/]+)$/))) {
      const bookings = { 'BK-SAME': { user_id: 'itest-a', psikolog_id: 'PSY-TEST' }, 'BK-OTHER': { user_id: 'itest-b', psikolog_id: 'PSY-OTHER' }, 'BK-NOTMINE': { user_id: 'someone', psikolog_id: 'PSY-TEST' } };
      const b = bookings[m[1]]; return b ? ok(res, { ...b, status: 'PAID', counseling_datetime: null }) : nf(res);
    }
    if (p === '/v2/internal/ai/notifications' && req.method === 'POST') {
      let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => { const parsed = JSON.parse(body); for (const n of parsed.notifications) notifications.push(n); ok(res, parsed.notifications.map((n) => ({ notification_key: n.notification_key, status: 'sent' }))); }); return;
    }
  }
  nf(res);
}).listen(Number(process.env.FAKE_V3_PORT ?? 18300), () => console.log('fake v3 ready'));
