// Phase 4 (consent, age gate, history deletion, account delete/merge) and Phase 5 (persona
// curation by its psikolog, evaluation, disabling mid-session, clinical content review, safety
// review, psikolog handoff list). All conversation text is synthetic.
import { A, B, Client, FAKE_V3, check, failures, secret, sleep, sql, tokens as loadTokens } from './lib.mjs';
const tokens = loadTokens();
const INBOUND = secret('inbound');
const CRISIS = 'kadang aku pengen mati aja rasanya';
// Current DRAFT service consent text (content/consents/service.json); v1 agreements stay valid.
const SERVICE_V = 2;
const count = (table, where) => Number(sql(`select count(*) from ${table} where ${where}`));
const userRows = (id) =>
  ['ai_sessions', 'ai_session_summaries', 'ai_consents', 'ai_user_state', 'ai_user_routines', 'ai_routine_proposals', 'ai_handoffs']
    .map((t) => count(t, `user_id = '${id}'`)).reduce((a, b) => a + b, 0);
const until = async (fn, timeout = 20000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) { if (await fn()) return true; await sleep(250); }
  return false;
};
const post = (base, path, body, headers = {}) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

// --- Phase 4: service consent ----------------------------------------------------------------
const p4 = new Client(A, tokens['itest-p4-a']);
await p4.ready();
let onboarding = (await p4.rest('/me/onboarding')).body.data;
check('onboarding: consent required before the first message', onboarding.ready === false && onboarding.blocked.code === 'CONSENT_REQUIRED' && onboarding.consents.service.text.version === SERVICE_V, JSON.stringify(onboarding.blocked));
let r = await p4.say('halo, aku mau cerita');
check('message without consent is refused with help attached, nothing stored', r.ack.ok === false && r.ack.code === 'CONSENT_REQUIRED' && r.ack.help?.contacts?.length > 0 && count('ai_sessions', "user_id = 'itest-p4-a'") === 0, JSON.stringify(r.ack));
const sessionlessBefore = count('ai_safety_events', 'session_id is null');
r = await p4.say(CRISIS);
const escalation = await p4.waitFor('safety.escalation', (p) => p.level === 'crisis', 5000, r.mark).catch(() => null);
check('crisis message without consent still gets the protocol', r.ack.code === 'CONSENT_REQUIRED' && escalation?.protocol?.contacts?.length > 0);
check('…audited without a session or user', count('ai_safety_events', 'session_id is null') === sessionlessBefore + 1 && count('ai_messages m join ai_sessions s on s.id = m.session_id', "s.user_id = 'itest-p4-a'") === 0);
let res = await p4.rest('/me/consents', { method: 'POST', body: JSON.stringify({ type: 'service', text_version: 99, granted: true }) });
check('agreeing to a text the user did not see is refused', res.status === 409, JSON.stringify(res.body));
res = await p4.rest('/me/consents', { method: 'POST', body: JSON.stringify({ type: 'service', text_version: SERVICE_V, granted: true }) });
check('service consent recorded', res.status === 201 && res.body.data.granted === true, JSON.stringify(res.body));
r = await p4.turn('aku lagi susah tidur akhir-akhir ini');
check('after consent the conversation starts', r.end?.[0] === 'ai.done', JSON.stringify(r.ack));
check('session without training consent is excluded from training', sql("select bool_and(exclude_from_training) from ai_sessions where user_id = 'itest-p4-a'") === 't');

// --- Phase 4: training consent offer --------------------------------------------------------
sql(`insert into ai_sessions (id, user_id, period_month, status, end_reason, ended_at, counts_toward_quota)
     select gen_random_uuid(), 'itest-p4-a', '2000-01', 'ended', 'completed', now(), false from generate_series(1, 2)`);
let mark = p4.mark();
res = await p4.rest('/me/consents', { method: 'POST', body: JSON.stringify({ type: 'service', text_version: SERVICE_V, granted: false }) });
const ended = await p4.waitFor('session.ended', () => true, 5000, mark).catch(() => null);
check('revoking service consent ends the running session', res.body?.data?.granted === false && ended?.reason === 'completed');
check('third calm session ends with the training consent offer', ended?.consent_offer?.type === 'ai_training' && ended.consent_offer.text.summary.length > 0, JSON.stringify(ended?.consent_offer));
await p4.rest('/me/consents', { method: 'POST', body: JSON.stringify({ type: 'service', text_version: SERVICE_V, granted: true }) });
res = await p4.rest('/me/consents', { method: 'POST', body: JSON.stringify({ type: 'ai_training', text_version: 1, granted: true }) });
check('training consent granted', res.body?.data?.granted === true);
r = await p4.turn('hari ini lumayan');
check('new session with training consent may be used for training', sql("select exclude_from_training from ai_sessions where user_id = 'itest-p4-a' and status = 'active'") === 'f');
await p4.rest('/me/consents', { method: 'POST', body: JSON.stringify({ type: 'ai_training', text_version: 1, granted: false }) });
check('revoking training consent excludes every session, past ones too', sql("select bool_and(exclude_from_training) from ai_sessions where user_id = 'itest-p4-a'") === 't');

// --- Phase 4: re-consent after a material change ---------------------------------------------
sql(`insert into ai_content_versions (id, kind, ref_id, version, body, status, author_id) values (gen_random_uuid(), 'consent_text', 'service', 900,
  '{"type":"service","title":"[DRAFT] uji","summary":["[DRAFT] uji"],"body":"[DRAFT] uji","min_accepted_version":900}', 'draft', 'seed:e2e')`);
await sleep(1500);
onboarding = (await p4.rest('/me/onboarding')).body.data;
check('material change asks for consent again', onboarding.blocked?.code === 'RECONSENT_REQUIRED' && onboarding.consents.service.reconsent_required === true, JSON.stringify(onboarding.blocked));
res = await p4.rest('/me/consents', { method: 'POST', body: JSON.stringify({ type: 'service', text_version: 900, granted: true }) });
onboarding = (await p4.rest('/me/onboarding')).body.data;
check('agreeing to the new text unblocks', onboarding.ready === true);
sql("delete from ai_content_versions where kind = 'consent_text' and version = 900");
await sleep(1500);

// --- Phase 4: age gate -----------------------------------------------------------------------
const nodob = new Client(B, tokens['itest-p4-nodob']);
const minor = new Client(A, tokens['itest-p4-minor']);
await Promise.all([nodob.ready(), minor.ready()]);
onboarding = (await nodob.rest('/me/onboarding')).body.data;
check('missing birth date → ask for it', onboarding.blocked?.code === 'AGE_REQUIRED' && onboarding.age.status === 'missing');
r = await minor.say('halo');
check('under the minimum age → refused', r.ack.code === 'AGE_RESTRICTED' && /18 tahun/.test(r.ack.message), JSON.stringify(r.ack));
r = await minor.say(CRISIS);
check('under-age crisis message still gets the protocol', r.ack.code === 'AGE_RESTRICTED' && !!(await minor.waitFor('safety.escalation', (p) => p.level === 'crisis', 5000, r.mark).catch(() => null)));
await post(FAKE_V3, '/test/users/itest-p4-nodob/birth_date', { birth_date: '2000-02-02' });
onboarding = (await nodob.rest('/me/onboarding')).body.data;
check('after the birth date is saved in v3, only consent remains', onboarding.age.status === 'ok' && onboarding.blocked?.code === 'CONSENT_REQUIRED');
nodob.close(); minor.close();

// --- Phase 4: delete history -----------------------------------------------------------------
const quotaBefore = (await p4.rest('/sessions/current')).body.data.state.quota.used;
res = await p4.rest('/me/history', { method: 'DELETE' });
check('DELETE /v1/me/history → 204', res.status === 204);
check('history deleted: no messages, no summaries, sessions kept without topics',
  count('ai_messages m join ai_sessions s on s.id = m.session_id', "s.user_id = 'itest-p4-a'") === 0 &&
  count('ai_session_summaries', "user_id = 'itest-p4-a'") === 0 &&
  count('ai_sessions', "user_id = 'itest-p4-a' and (topics <> '{}' or router_reason is not null)") === 0 &&
  count('ai_sessions', "user_id = 'itest-p4-a'") > 0);
check('quota unchanged by deleting history', (await p4.rest('/sessions/current')).body.data.state.quota.used === quotaBefore);

// --- Phase 4: account deletion via webhook ---------------------------------------------------
const del = new Client(A, tokens['itest-p4-del']);
await del.ready();
r = await del.turn('aku ingin cerita soal kerjaan');
check('user to be deleted has data', r.end?.[0] === 'ai.done' && userRows('itest-p4-del') > 0);
let hook = await post(A, '/v1/internal/users/itest-p4-del/delete', { event_id: 'itest-del-1' }, { 'x-ai-gateway-token': INBOUND });
const hookBody = await hook.json();
check('delete webhook applied', hook.status === 200 && hookBody.data.result === 'applied', JSON.stringify(hookBody));
check('no row of the deleted user remains', userRows('itest-p4-del') === 0);
check('the deleted user\'s sockets are disconnected', await until(() => !del.socket.connected, 3000));
res = await del.rest('/me/consents', { method: 'POST', body: JSON.stringify({ type: 'service', text_version: SERVICE_V, granted: true }) });
check('a still-valid token of the deleted account cannot write again (tombstone)', res.status === 401 && userRows('itest-p4-del') === 0, JSON.stringify(res.body));
hook = await post(B, '/v1/internal/users/itest-p4-del/delete', { event_id: 'itest-del-1' }, { 'x-ai-gateway-token': INBOUND });
check('replayed webhook is a no-op', (await hook.json()).data.result === 'duplicate');
hook = await post(A, '/v1/internal/users/x/delete', { event_id: 'itest-x' }, { 'x-ai-gateway-token': 'wrong'.repeat(10) });
check('webhook with a wrong token is refused', hook.status === 401);

// --- Phase 4: deletion and merge via the pulled feed (webhook missed) -------------------------
const pull = new Client(B, tokens['itest-p4-pull']);
const from = new Client(A, tokens['itest-p4-from']);
const to = new Client(B, tokens['itest-p4-to']);
await Promise.all([pull.ready(), from.ready(), to.ready()]);
await pull.turn('halo');
await from.turn('aku mau berhenti merokok');
await to.turn('aku susah tidur');
check('three users with sessions', count('ai_sessions', "user_id in ('itest-p4-pull','itest-p4-from','itest-p4-to')") === 3);
await post(FAKE_V3, '/test/account-events', { kind: 'delete', user_id: 'itest-p4-pull' });
await post(FAKE_V3, '/test/account-events', { kind: 'merge', user_id: 'itest-p4-from', target_user_id: 'itest-p4-to' });
check('pulled delete applied within the sync interval', await until(() => userRows('itest-p4-pull') === 0, 20000));
check('pulled merge moved everything to the surviving account', await until(() => userRows('itest-p4-from') === 0 && count('ai_sessions', "user_id = 'itest-p4-to'") === 2, 20000));
check('merged account has one open session (the source\'s ended)', count('ai_sessions', "user_id = 'itest-p4-to' and status in ('active','closing')") === 1);
const toQuota = (await to.rest('/sessions/current')).body.data.state.quota;
check('quota recomputed after merge', toQuota.used === 2, JSON.stringify(toQuota));
check('cursor stored', Number(sql("select value from ai_sync_cursors where name = 'v3-account-events'")) >= 1001);
pull.close(); from.close(); to.close(); del.close();

// --- Phase 5: roles --------------------------------------------------------------------------
const psy = new Client(A, tokens['PSY-P5']);
const rev = new Client(B, tokens['PSY-REV']);
res = await psy.rest('/psikolog/me');
check('psikolog token → /v1/psikolog/me', res.status === 200 && res.body.data.roles.join() === 'psikolog', JSON.stringify(res.body));
check('user token cannot use psikolog routes', (await p4.rest('/psikolog/me')).status === 403);
check('psikolog without the reviewer role cannot curate content', (await psy.rest('/review/content')).status === 403);
sql("insert into ai_staff_roles (psychologist_id, role, granted_by) values ('PSY-REV','clinical_reviewer','e2e'), ('PSY-REV2','clinical_reviewer','e2e')");
check('reviewer role from ai_staff_roles', (await rev.rest('/psikolog/me')).body.data.roles.includes('clinical_reviewer'));

// --- Phase 5: persona curation ---------------------------------------------------------------
const stage = async () => (await psy.rest('/psikolog/persona/status')).body?.data;
let status = await stage();
check('home card status: not started, and reading it creates no workspace',
  status?.stage === 'not_started' && status.questionnaire.required > 0 && count('ai_persona_workspaces', "psychologist_id = 'PSY-P5'") === 0, JSON.stringify(status));
let ws = (await psy.rest('/psikolog/persona')).body.data;
check('workspace: questionnaire and case studies available', ws.questionnaire?.questions.length > 0 && ws.cases.length >= 8 && ws.persona === null, JSON.stringify({ q: ws.questionnaire?.questions.length, c: ws.cases.length }));
res = await psy.rest('/psikolog/persona/draft', { method: 'POST' });
check('draft refused while the questionnaire is incomplete', res.status === 400 && res.body.code === 'QUESTIONNAIRE_INCOMPLETE', JSON.stringify(res.body));
const answers = Object.fromEntries(ws.questionnaire.questions.map((q) => [q.id, `Jawaban sintetis untuk ${q.id}`]));
answers.approach_name = 'Uji Reflektif';
answers.focus_topics = 'kecemasan, tidur';
ws = (await psy.rest('/psikolog/persona/questionnaire', { method: 'PUT', body: JSON.stringify({ answers }) })).body.data;
check('questionnaire saved', ws.requirements.questionnaire_complete === true && ws.display_name === 'Uji Reflektif');
status = await stage();
check('home card status: questionnaire done → example case study next', status?.stage === 'cases' && status.questionnaire.answered === status.questionnaire.required, JSON.stringify(status));
for (const c of ws.cases) {
  await psy.rest(`/psikolog/persona/cases/${c.ref}`, { method: 'PUT', body: JSON.stringify({ response: `Jawaban ideal sintetis (${c.ref}): aku dengar kamu, ceritakan lebih lanjut ya.` }) });
}
check('home card status: ready to draft', (await stage())?.stage === 'draft');
res = await psy.rest('/psikolog/persona/draft', { method: 'POST' });
ws = res.body.data;
const v1 = ws?.versions?.[0];
check('home card status: draft waiting for review', (await stage())?.stage === 'review');
check('draft Persona Card created (agent, Pro tier) with the psikolog\'s own few-shots', res.status === 201 && v1.version === 1 && v1.status === 'draft' && v1.card.few_shots.length === 3 && v1.card.focus_topics.join() === 'kecemasan,tidur', JSON.stringify(res.body).slice(0, 400));
check('persona stays disabled until approved', ws.persona?.status === 'disabled' && ws.persona.active_version === null);
check('a disabled persona is not offered to users', !(await p4.rest('/personas')).body.data.some((p) => p.id === ws.persona_id));
res = await psy.rest('/psikolog/persona/versions/1/approve', { method: 'POST' });
check('approval without an evaluation is refused', res.status === 409 && res.body.code === 'EVAL_REQUIRED', JSON.stringify(res.body));
ws = (await psy.rest('/psikolog/persona/versions', { method: 'POST', body: JSON.stringify({ card: { ...v1.card, tone: 'Hangat, tenang, tidak menggurui.' } }) })).body.data;
check('correction is a new version', ws.versions[0].version === 2 && ws.versions[0].card.tone.startsWith('Hangat'));
res = await psy.rest('/psikolog/persona/versions/2/eval-runs', { method: 'POST' });
const runId = res.body.data?.id;
check('evaluation started', res.status === 201 && runId, JSON.stringify(res.body));
let run = null;
await until(async () => { run = (await psy.rest(`/psikolog/persona/eval-runs/${runId}`)).body.data; return run.status === 'completed' || run.status === 'failed'; }, 30000);
check('evaluation completed over every eval case', run?.status === 'completed' && run.ratings.length === 5 && run.ratings.every((x) => x.ai_response && x.scenario && x.ideal_response), JSON.stringify(run).slice(0, 300));
check('another psikolog cannot read this evaluation', (await rev.rest(`/psikolog/persona/eval-runs/${runId}`)).status === 404);
for (const [i, rating] of run.ratings.entries()) {
  await psy.rest(`/psikolog/persona/eval-runs/${runId}/ratings/${rating.id}`, { method: 'PUT', body: JSON.stringify({ safe: i !== 0, on_style: true, notes: i === 0 ? 'Perlu lebih hati-hati' : undefined }) });
}
res = await psy.rest('/psikolog/persona/versions/2/approve', { method: 'POST' });
check('an answer rated unsafe blocks approval', res.status === 409 && /tidak aman/.test(res.body.message), JSON.stringify(res.body));
await psy.rest(`/psikolog/persona/eval-runs/${runId}/ratings/${run.ratings[0].id}`, { method: 'PUT', body: JSON.stringify({ safe: true, on_style: true }) });
res = await psy.rest('/psikolog/persona/versions/2/approve', { method: 'POST' });
ws = res.body.data;
check('psikolog approves the evaluated version', res.status === 201 && ws.persona.status === 'active' && ws.persona.active_version === 2, JSON.stringify(res.body).slice(0, 300));
status = await stage();
check('home card status: active, with the approach name', status?.stage === 'active' && status.display_name === 'Uji Reflektif', JSON.stringify(status));
check('approved version records approver and time', sql(`select approved_by is not null and approved_at is not null from ai_content_versions where kind = 'persona_card' and ref_id = '${ws.persona_id}' and version = 2`) === 't');
await sleep(1500);
const listed = (await p4.rest('/personas')).body.data.find((p) => p.id === ws.persona_id);
check('approved persona offered to users with its label', listed?.label === 'DeepTalk AI dengan pendekatan Uji Reflektif' && listed.draft === false, JSON.stringify(listed));

// --- Phase 5: disabling stops the persona in a running session within one turn --------------
await p4.emit('session.start', { persona_id: ws.persona_id });
r = await p4.turn('aku cemas soal besok');
const st = await p4.waitFor('session.state', (p) => p.persona?.id === ws.persona_id, 5000, r.mark).catch(() => null);
check('user talks with the new persona', r.end?.[0] === 'ai.done' && st?.persona?.id === ws.persona_id, JSON.stringify(r.ack));
await psy.rest('/psikolog/persona/disable', { method: 'POST' });
r = await p4.turn('masih cemas');
const unavailable = await p4.waitFor('persona.unavailable', () => true, 5000, r.mark).catch(() => null);
check('next turn after disabling → persona.unavailable', unavailable?.persona_id === ws.persona_id && r.end?.[0] === 'ai.done', JSON.stringify(unavailable));
check('re-enabling needs no new approval', (await psy.rest('/psikolog/persona/enable', { method: 'POST' })).body.data.persona.status === 'active');
await psy.rest('/psikolog/persona/disable', { method: 'POST' });

// --- Phase 5: clinical content review --------------------------------------------------------
res = await rev.rest('/review/content');
check('reviewer sees the curated kinds (not persona cards)', res.status === 200 && res.body.data.kinds.includes('protocol') && !res.body.data.kinds.includes('persona_card'));
res = await rev.rest('/review/content/protocol/crisis/versions/1/approve', { method: 'POST' });
check('engineering DRAFT seed can never be approved', res.status === 403 && res.body.code === 'ENGINEERING_SEED', JSON.stringify(res.body));
res = await rev.rest('/review/content/assessment_mapping/kecemasan/versions', { method: 'POST', body: JSON.stringify({ body: { topic: 'tidur', assessment_product_ids: ['ASM-TEST'] } }) });
check('cross-field rule enforced (topic = ref_id)', res.status === 400);
res = await rev.rest('/review/content/assessment_mapping/kecemasan/versions', { method: 'POST', body: JSON.stringify({ body: { topic: 'kecemasan', assessment_product_ids: ['ASM-TEST'] } }) });
const mv = res.body.data?.version;
check('reviewer writes a new version as draft', res.status === 201 && res.body.data.status === 'draft' && res.body.data.author_id === 'PSY-REV', JSON.stringify(res.body));
check('submit for review', (await rev.rest(`/review/content/assessment_mapping/kecemasan/versions/${mv}/submit`, { method: 'POST' })).body.data?.status === 'in_review');
res = await rev.rest(`/review/content/assessment_mapping/kecemasan/versions/${mv}/approve`, { method: 'POST' });
check('the author cannot approve their own version', res.status === 403 && res.body.code === 'SELF_APPROVAL');
const rev2 = new Client(A, tokens['PSY-REV2']);
res = await rev2.rest(`/review/content/assessment_mapping/kecemasan/versions/${mv}/approve`, { method: 'POST' });
check('a second reviewer approves', res.status === 201 && res.body.data.status === 'approved' && res.body.data.approved_by === 'PSY-REV2', JSON.stringify(res.body));
res = await rev.rest('/review/content/assessment_mapping/kecemasan/versions', { method: 'POST', body: JSON.stringify({ body: { topic: 'kecemasan', assessment_product_ids: ['ASM-TEST', 'ASM-OTHER'] } }) });
await rev.rest(`/review/content/assessment_mapping/kecemasan/versions/${res.body.data.version}/submit`, { method: 'POST' });
res = await rev2.rest(`/review/content/assessment_mapping/kecemasan/versions/${res.body.data.version}/reject`, { method: 'POST', body: JSON.stringify({ notes: 'ASM-OTHER bukan untuk kecemasan' }) });
check('rejection keeps the reason', res.body.data?.status === 'rejected' && res.body.data.review_notes.startsWith('ASM-OTHER'));
const history = (await rev.rest('/review/content/assessment_mapping/kecemasan')).body.data;
check('version history shows who approved', history.some((v) => v.status === 'approved' && v.approved_by === 'PSY-REV2' && v.approved_at));
let dbError = '';
try { sql("insert into ai_content_versions (id, kind, ref_id, version, body, status) values (gen_random_uuid(), 'protocol', 'itest-check', 1, '{}', 'approved')"); } catch (e) { dbError = String(e.stderr ?? e); }
check('database refuses approved content without approver (CHECK)', /ai_content_versions_approved_has_approver/.test(dbError), dbError.slice(0, 200));

// --- Phase 5: safety review ------------------------------------------------------------------
res = await rev.rest('/review/safety-events?status=open&level=crisis');
const event = res.body.data?.items?.[0];
check('reviewer lists crisis events without user identity or content', res.status === 200 && event && !('user_id' in event) && !JSON.stringify(event).includes('pengen mati'), JSON.stringify(event));
res = await rev.rest(`/review/safety-events/${event.id}`, { method: 'PATCH', body: JSON.stringify({ review_notes: 'Protokol terkirim, tidak perlu tindak lanjut (uji).' }) });
check('review notes recorded', res.status === 200 && res.body.data.reviewed_by === 'PSY-REV');
check('reviewed events move out of the open list', !(await rev.rest('/review/safety-events?status=open&level=crisis')).body.data.items.some((e) => e.id === event.id));

// --- Phase 6: report an AI reply (app store AI-content policy) ------------------------------
r = await p4.turn('aku mau cerita lagi');
const replyId = r.end?.[1]?.message_id;
res = await p4.rest(`/messages/${replyId}/report`, { method: 'POST', body: JSON.stringify({ reason: 'harmful', share_content: true }) });
check('user reports an AI reply', res.status === 201 && res.body.data.reported === true, JSON.stringify(res.body));
check('report stores no user identity', count('ai_message_reports', `message_id = '${replyId}'`) === 1 && !sql("select column_name from information_schema.columns where table_name = 'ai_message_reports'").includes('user_id'));
const p4Message = sql("select m.id from ai_messages m join ai_sessions s on s.id = m.session_id where s.user_id = 'itest-p4-a' and m.role = 'user' limit 1");
check('a user message cannot be reported', (await p4.rest(`/messages/${p4Message}/report`, { method: 'POST', body: JSON.stringify({ reason: 'other', share_content: true }) })).status === 404);
const other = new Client(B, tokens['itest-p4-to']);
check("someone else's reply cannot be reported", (await other.rest(`/messages/${replyId}/report`, { method: 'POST', body: JSON.stringify({ reason: 'other', share_content: false }) })).status === 404);
other.close();
let reports = (await rev.rest('/review/reports?status=open')).body.data.items;
check('reviewer reads the shared reply text', reports.some((x) => x.content_available && x.ai_response && x.reason === 'harmful'));
await p4.rest(`/messages/${replyId}/report`, { method: 'POST', body: JSON.stringify({ reason: 'inaccurate', share_content: false }) });
reports = (await rev.rest('/review/reports?status=open')).body.data.items;
check('withdrawing permission hides the text again', reports.some((x) => x.reason === 'inaccurate' && x.ai_response === null && !x.content_available));
check('psikolog without the reviewer role cannot read reports', (await psy.rest('/review/reports')).status === 403);
await p4.rest(`/messages/${replyId}/report`, { method: 'POST', body: JSON.stringify({ reason: 'harmful', share_content: true }) });
await p4.rest('/me/history', { method: 'DELETE' });
reports = (await rev.rest('/review/reports?status=open')).body.data.items;
check('after history deletion the report stays without the reply', reports.some((x) => x.reason === 'harmful' && !x.content_available) && count('ai_message_reports', 'message_id is null') >= 1);
res = await rev.rest(`/review/reports/${reports[0].id}`, { method: 'PATCH', body: JSON.stringify({ review_notes: 'Ditinjau (uji).' }) });
check('report review recorded', res.status === 200);

// --- Phase 5: psikolog handoff list ----------------------------------------------------------
sql(`insert into ai_handoffs (id, session_id, user_id, psychologist_id, reason, draft_ciphertext, status, booking_id, linked_at)
     values (gen_random_uuid(), gen_random_uuid(), 'itest-a', 'PSY-TEST', 'Uji', '\\x00', 'linked', 'BK-SAME', now())`);
const psyTest = new Client(B, tokens['PSY-TEST']);
res = await psyTest.rest('/psikolog/handoffs');
const mine = res.body.data?.[0];
check('assigned psikolog lists summaries linked to their bookings', res.status === 200 && mine?.booking_id === 'BK-SAME');
check('another psikolog cannot open it (404)', (await psy.rest(`/psikolog/handoffs/${mine.handoff_id}`)).status === 404);
check('…and does not see it in their list', (await psy.rest('/psikolog/handoffs')).body.data.length === 0);

for (const c of [p4, psy, rev, rev2, psyTest]) c.close();
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
