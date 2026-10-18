import { A, B, Client, FAKE_V3, check, failures, secret, sleep, sql, stack, tokens as loadTokens } from './lib.mjs';
const tokens = loadTokens();
const INBOUND = secret('inbound');
const SCHED = secret('scheduler');

// --- Quick Chat, router, fan-out ------------------------------------------------------------
const a = new Client(A, tokens['itest-a']);
const a2 = new Client(B, tokens['itest-a']);
const first = await Promise.all([a.ready(), a2.ready()]);
check('session.state on connect has quota and no session', first[0].status === 'none' && first[0].quota?.limit === 2);
const personas = await a.rest('/personas');
check('GET /v1/personas lists DRAFT personas with label', personas.status === 200 && personas.body.data.length === 2 && personas.body.data[0].label.startsWith('DeepTalk AI dengan pendekatan'));
check('session.start (Quick Chat) acked', (await a.emit('session.start', {})).ok === true);

let r = await a.turn('aku pengen berhenti merokok, makin sering kalau stres');
check('first turn completes', r.end?.[0] === 'ai.done', JSON.stringify(r.end));
const state = await a.waitFor('session.state', (p) => p.persona && p.router_reason, 5000);
check('router picked a persona and explained why', state.persona.id === 'draft-terstruktur' && /karena fokus pada rokok/.test(state.router_reason), JSON.stringify(state));
check('reply reached the other instance too', (await a2.waitFor('ai.done', () => true, 5000)).content === r.end[1].content);
check('label "DeepTalk AI dengan pendekatan" in state', state.persona.label === 'DeepTalk AI dengan pendekatan Contoh Terstruktur (DRAFT)');
const firstTokenIdx = a.since(r.mark).findIndex(([e]) => e === 'ai.token');
check('tokens streamed', firstTokenIdx >= 0);

// --- Routine ---------------------------------------------------------------------------------
r = await a.turn('boleh bantu aku bikin rutinitas buat kurangi rokok?');
const routineCard = await a.waitFor('card.routine', () => true, 8000, r.mark).catch(() => null);
check('card.routine offered from the library', routineCard && routineCard.routine.items.every((i) => i.id.startsWith('smk_')), JSON.stringify(routineCard));
const decision = await a.emit('routine.decision', { proposal_id: routineCard.proposal_id, decision: 'edit', routine: { item_ids: [routineCard.routine.items[0].id], reminder_times: ['07:00'] } });
check('routine accepted with an edit (subset)', decision.ok === true && decision.routine_id, JSON.stringify(decision));
const again = await a.emit('routine.decision', { proposal_id: routineCard.proposal_id, decision: 'accept' });
check('a decided proposal cannot be decided again', again.ok === false && again.code === 'HTTP_409');
const routines = await a.rest('/routines');
const routine = routines.body.data[0];
check('GET /v1/routines shows today checklist', routines.status === 200 && routine.items.length === 1 && routine.items[0].done === false);
const kind = routine.routine.items[0].kind;
const logRes = await a.rest(`/routines/${routine.id}/logs`, { method: 'POST', body: JSON.stringify({ item_id: routine.items[0].id, date: routine.today, done: true, ...(kind === 'scale' ? { value: 3 } : {}), note: 'lumayan' }) });
const badValue = await a.rest(`/routines/${routine.id}/logs`, { method: 'POST', body: JSON.stringify({ item_id: routine.items[0].id, date: routine.today, done: true, value: 99 }) });
check('out-of-scale value rejected', badValue.status === 400);
check('log today', logRes.status === 204, JSON.stringify(logRes));
const badLog = await a.rest(`/routines/${routine.id}/logs`, { method: 'POST', body: JSON.stringify({ item_id: 'fake_item', date: routine.today, done: true }) });
check('log with an unknown item rejected', badLog.status === 400);
const hist = await a.rest(`/routines/${routine.id}/history`);
check('history returns decrypted note', hist.body.data[0]?.note === 'lumayan');
const summary = await a.rest(`/routines/${routine.id}/summary`);
check('weekly summary', summary.status === 200 && typeof summary.body.data.adherence === 'number');
const other = new Client(A, tokens['itest-b']); await other.ready();
check("another user cannot read this routine", (await other.rest(`/routines/${routine.id}/summary`)).status === 404);

// --- Assessment + handoff --------------------------------------------------------------------
r = await a.turn('aku juga mau ikut tes asesmen');
const asm = await a.waitFor('card.assessment', () => true, 8000, r.mark).catch(() => null);
check('card.assessment built from catalog', asm?.assessment_id === 'ASM-TEST' && asm.title === 'Tes Uji Kecemasan', JSON.stringify(asm));
check('assessment card carries a referral (impact indicator)', typeof asm?.referral_id === 'string' && sql(`select count(*) from ai_assessment_referrals where id = '${asm.referral_id}' and opened_at is null`) === '1');
const opened = await a.rest(`/assessments/referrals/${asm.referral_id}/opened`, { method: 'POST' });
check('opening the assessment is recorded', opened.status === 204 && sql(`select count(*) from ai_assessment_referrals where id = '${asm.referral_id}' and opened_at is not null`) === '1');
const bClient = new Client(B, tokens['itest-b']);
await bClient.rest(`/assessments/referrals/${asm.referral_id}/opened`, { method: 'POST' });
check("another user's call changes nothing", sql(`select count(*) from ai_assessment_referrals where opened_at is not null and user_id = 'itest-a'`) === '1');
bClient.close();
r = await a.turn('kayaknya aku butuh psikolog');
const ho = await a.waitFor('card.handoff', () => true, 10000, r.mark).catch(() => null);
check('card.handoff with draft sections', ho?.psikolog?.id === 'PSY-TEST' && ho.draft_sections.length >= 1, JSON.stringify(ho));
const approve = await a.emit('handoff.decision', { handoff_id: ho.handoff_id, decision: 'approve', removed_section_ids: ['topik'] });
check('handoff approved with a removed section; deep links returned', approve.ok && approve.deep_links.web === `/psychologists/PSY-TEST?ai_handoff=${ho.handoff_id}`, JSON.stringify(approve));
const notMine = await a.rest(`/handoffs/${ho.handoff_id}/link`, { method: 'POST', body: JSON.stringify({ booking_id: 'BK-NOTMINE' }) });
check("linking someone else's booking → 404", notMine.status === 404);
const link = await a.rest(`/handoffs/${ho.handoff_id}/link`, { method: 'POST', body: JSON.stringify({ booking_id: 'BK-SAME' }) });
check('linked to booking with the same psikolog', link.body?.data?.status === 'linked', JSON.stringify(link));
await sleep(1500);
const notes = await (await fetch(`${FAKE_V3}/test/notifications`)).json();
check('psikolog notified via v3 (generic text)', notes.some((n) => n.audience === 'psikolog' && n.recipient_id === 'PSY-TEST' && !/rokok|stres/i.test(n.body)), JSON.stringify(notes));
const internal = (psikolog, token = INBOUND) => fetch(`${A}/v1/internal/handoffs/by-booking/BK-SAME?psikolog_id=${psikolog}`, { headers: { 'x-ai-gateway-token': token } });
const wrongPsy = await internal('PSY-OTHER');
check('unassigned psikolog cannot read the summary (404)', wrongPsy.status === 404);
check('wrong service token → 401', (await internal('PSY-TEST', 'x'.repeat(48))).status === 401);
const read = await internal('PSY-TEST');
const readBody = await read.json();
check('assigned psikolog reads the approved summary without removed sections', read.status === 200 && !readBody.data.sections.some((s) => s.id === 'topik') && readBody.data.disclaimer.includes('bukan diagnosis'), JSON.stringify(readBody));

// --- L3 and crisis ---------------------------------------------------------------------------
r = await a.turn('[uji-l3] aku susah tidur');
const l3tokens = a.since(r.mark).filter(([e]) => e === 'ai.token').map(([, p]) => p.delta).join('');
check('L3: medication never streamed, reply replaced', r.end?.[0] === 'ai.done' && r.end[1].replaced === true && !/sertraline|50 mg/.test(l3tokens), JSON.stringify(r.end));
r = await a.turn('kadang aku pengen mati aja rasanya');
const crisisEvents = a.since(r.mark).map(([e]) => e);
check('L1 crisis → protocol, no persona tokens', r.end?.[0] === 'safety.escalation' && !crisisEvents.includes('ai.token') && !crisisEvents.includes('ai.done'), crisisEvents.join(','));
check('protocol carries contacts', r.end?.[1]?.protocol?.contacts?.length > 0);
const st = await a.waitFor('session.state', (p) => p.risk_level === 'crisis', 5000, r.mark).catch(() => null);
check('session risk is now crisis (sticky)', st?.risk_level === 'crisis');
r = await a.turn('makasih, aku udah agak tenang');
check('after crisis the persona continues (calm mode)', r.end?.[0] === 'ai.done');
const cur = await a.rest('/sessions/current');
check('history contains the protocol message', cur.body.data.messages.some((m) => m.role === 'protocol'));

// --- Fake IDs from a misbehaving agent never pass (validated in gateway unit tests) -------------
// --- Scheduler reminders ---------------------------------------------------------------------
const now = new Date();
const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
const routinesNow = await a.rest('/routines');
await a.rest(`/routines/${routine.id}`, { method: 'PATCH', body: JSON.stringify({ reminder_times: [hhmm] }) });
// Item already logged done today → no reminder; undo it first.
await a.rest(`/routines/${routine.id}/logs`, { method: 'POST', body: JSON.stringify({ item_id: routinesNow.body.data[0].items[0].id, date: routinesNow.body.data[0].today, done: false }) });
const schedNoToken = await fetch(`${A}/v1/internal/scheduler/routine-reminders`, { method: 'POST' });
check('scheduler endpoint requires its token', schedNoToken.status === 401);
const sched = await (await fetch(`${A}/v1/internal/scheduler/routine-reminders`, { method: 'POST', headers: { 'x-scheduler-token': SCHED } })).json();
check('scheduler queued a reminder', sched.data.queued === 1, JSON.stringify(sched));
await sleep(1500);
const notes2 = await (await fetch(`${FAKE_V3}/test/notifications`)).json();
check('reminder delivered with generic text', notes2.some((n) => n.audience === 'user' && n.recipient_id === 'itest-a' && n.body === 'Waktunya routine harianmu.'));

// --- Memory settings ---------------------------------------------------------------------------
check('memory on by default', (await a.rest('/me/settings')).body.data.memory_enabled === true);
check('memory can be turned off', (await a.rest('/me/settings', { method: 'PATCH', body: JSON.stringify({ memory_enabled: false }) })).body.data.memory_enabled === false);
await a.rest('/me/settings', { method: 'PATCH', body: JSON.stringify({ memory_enabled: true }) });

// --- Phase 7: impact indicators (Konsep §8) ----------------------------------------------------
sql("insert into ai_staff_roles (psychologist_id, role, granted_by) values ('PSY-REV','clinical_reviewer','e2e') on conflict do nothing");
const reviewer = new Client(A, tokens['PSY-REV']);
const impact = (await reviewer.rest('/review/impact?days=1')).body?.data;
check('impact indicators aggregate routines, referrals, handoffs, crisis sessions',
  impact?.routines.accepted >= 1 && impact.assessments.offered >= 1 && impact.assessments.opened >= 1 &&
  impact.psikologs.booked >= 1 && impact.conversations.crisis_sessions >= 1, JSON.stringify(impact));
check('impact report carries no user identity', !JSON.stringify(impact ?? {}).includes('itest'));
const psyTest = new Client(A, tokens['PSY-TEST']);
check('impact needs the reviewer role', (await psyTest.rest('/review/impact')).status === 403);
[reviewer, psyTest].forEach((c) => c.close());

[a, a2, other].forEach((c) => c.close());
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
