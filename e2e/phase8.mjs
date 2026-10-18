// Phase 8: check-in, periodic screening, and personality inventory (DRAFT instruments), topic
// labels, content coverage, impact indicators, and the account lifecycle of the new data.
// All answers are synthetic.
import { A, B, Client, check, failures, secret, sleep, sql, tokens as loadTokens } from './lib.mjs';
const tokens = loadTokens();
const INBOUND = secret('inbound');
const TZ = 'Asia/Jakarta';
const count = (where) => Number(sql(`select count(*) from ai_instrument_responses where ${where}`));
const today = sql(`select (now() at time zone '${TZ}')::date`);
const until = async (fn, timeout = 20000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) { if (await fn()) return true; await sleep(250); }
  return false;
};
const submit = (client, ref, answers) =>
  client.rest(`/instruments/${ref}/responses`, { method: 'POST', body: JSON.stringify({ answers, timezone: TZ }) });
const CHECKIN = { suasana: 4, energi: 3, tidur: 2 };
const SCREEN_OK = { b1: 2, b2: 2, b3: 2, keamanan: 0 };

// A DRAFT mapping so a band that suggests an assessment has something to point to.
sql(`insert into ai_content_versions (id, kind, ref_id, version, body, status, author_id)
  values (gen_random_uuid(), 'assessment_mapping', 'kecemasan', 900, '{"topic":"kecemasan","assessment_product_ids":["ASM-TEST"]}', 'draft', 'seed:e2e')
  on conflict do nothing`);
await sleep(1500);

const user = new Client(A, tokens['itest-p8-a']);
const noConsent = new Client(B, tokens['itest-p8-noc']);
await Promise.all([user.ready(), noConsent.ready()]);

// --- Instruments: list and detail --------------------------------------------------------------
let res = await user.rest(`/instruments?tz=${encodeURIComponent(TZ)}`);
const list = res.body?.data?.items ?? [];
check('instruments listed with purpose and due state, check-in first',
  list[0]?.purpose === 'checkin' && ['checkin-harian', 'skrining-draft', 'inventori-kepribadian'].every((ref) => list.some((i) => i.ref === ref && i.due === true && i.draft === true)),
  JSON.stringify(list.map((i) => [i.ref, i.purpose, i.due])));
res = await user.rest('/instruments/skrining-draft');
const detail = res.body?.data;
check('detail has the questions but not safety thresholds or bands',
  detail?.items?.length === 4 && detail.items.every((i) => i.options.length === 4) && !JSON.stringify(detail).includes('min_value') && !('scoring' in detail),
  JSON.stringify(detail));
check('unknown instrument is 404', (await user.rest('/instruments/tidak-ada')).status === 404);

// --- Gates ---------------------------------------------------------------------------------------
res = await submit(noConsent, 'checkin-harian', CHECKIN);
check('answers need the service consent (same gate as chat)', res.status === 403 && res.body?.code === 'CONSENT_REQUIRED' && count("user_id = 'itest-p8-noc'") === 0, JSON.stringify(res.body));

// --- Daily check-in --------------------------------------------------------------------------------
res = await submit(user, 'checkin-harian', CHECKIN);
const first = res.body?.data;
check('check-in stored for today', res.status === 201 && first?.local_date === today && first.result.total.score === 3 && first.protocol === null, JSON.stringify(res.body));
check('answers and score exist only as ciphertext',
  sql(`select position('suasana' in encode(result_ciphertext, 'escape')) from ai_instrument_responses where id = '${first?.id}'`) === '0' &&
  sql(`select safety_level from ai_instrument_responses where id = '${first?.id}'`) === 'normal');
res = await submit(user, 'checkin-harian', { ...CHECKIN, suasana: 5 });
check('a second check-in the same day replaces the first', res.body?.data?.id === first?.id && count("user_id = 'itest-p8-a' and instrument_ref = 'checkin-harian'") === 1);
sql(`insert into ai_instrument_responses (id, user_id, instrument_ref, instrument_version, purpose, local_date, result_ciphertext, updated_at)
  select gen_random_uuid(), 'itest-p8-a', 'checkin-harian', 1, 'checkin', (now() at time zone '${TZ}')::date - 3, '\\x00', now()`);
res = await user.rest(`/instruments/checkin-harian/responses?days=7&tz=${encodeURIComponent(TZ)}`);
const history = res.body?.data;
check('trend history returns the user\'s own decrypted points; an unreadable row is skipped', res.status === 200 && history?.points?.length === 1 && history.points[0].answers.suasana === 5 && history.items.length === 3, JSON.stringify(history));
sql("delete from ai_instrument_responses where user_id = 'itest-p8-a' and result_ciphertext = '\\x00'");

// --- Periodic screening ------------------------------------------------------------------------------
res = await submit(user, 'skrining-draft', { ...SCREEN_OK, b1: 9 });
check('invalid answer value is refused with a code', res.status === 400 && res.body?.code === 'ANSWERS_INVALID_VALUE', JSON.stringify(res.body));
res = await submit(user, 'skrining-draft', { b1: 1 });
check('incomplete answers are refused', res.status === 400 && res.body?.code === 'ANSWERS_MISSING');
res = await submit(user, 'skrining-draft', SCREEN_OK);
let screen = res.body?.data;
check('screening result: band, disclaimer, assessment suggestion, next due in 14 days',
  screen?.result?.band?.suggest === 'assessment' && screen.result.disclaimer.length > 0 && screen.assessments?.[0]?.id === 'ASM-TEST' &&
  screen.next_due === sql(`select ((now() at time zone '${TZ}')::date + 14)::text`),
  JSON.stringify(screen));
sql(`update ai_instrument_responses set local_date = local_date - 1 where user_id = 'itest-p8-a' and instrument_ref = 'skrining-draft'`);
res = await submit(user, 'skrining-draft', SCREEN_OK);
check('screening again before the interval is refused', res.status === 409 && res.body?.code === 'INSTRUMENT_NOT_DUE', JSON.stringify(res.body));
sql(`update ai_instrument_responses set local_date = local_date - 14 where user_id = 'itest-p8-a' and instrument_ref = 'skrining-draft'`);
const crisisBefore = Number(sql("select count(*) from ai_safety_events where layer = 'instrument' and level = 'crisis'"));
res = await submit(user, 'skrining-draft', { b1: 0, b2: 0, b3: 0, keamanan: 1 });
screen = res.body?.data;
check('a safety item shows the crisis protocol even with a low total',
  res.status === 201 && screen?.result?.safety_level === 'crisis' && screen.protocol?.level === 'crisis' && screen.protocol.contacts.length > 0 && screen.result.band?.suggest === 'none',
  JSON.stringify(screen));
check('…and leaves a content-free safety event for review',
  Number(sql("select count(*) from ai_safety_events where layer = 'instrument' and level = 'crisis'")) === crisisBefore + 1 &&
  sql("select signals[1] from ai_safety_events where layer = 'instrument' order by created_at desc limit 1") === 'instrument:skrining-draft' &&
  sql("select session_id is null from ai_safety_events where layer = 'instrument' order by created_at desc limit 1") === 't');

// --- Personality inventory -------------------------------------------------------------------------
res = await submit(user, 'inventori-kepribadian', { d1a: 5, d1b: 1, d2a: 2, d2b: 4 });
const inventory = res.body?.data?.result;
check('inventory scores each dimension (reverse-keyed items flipped)',
  inventory?.dimensions?.map((d) => [d.id, d.score]).join() === 'dimensi_1,5,dimensi_2,2', JSON.stringify(inventory));
res = await user.rest(`/instruments?tz=${encodeURIComponent(TZ)}`);
const after = res.body?.data?.items ?? [];
check('answered inventory is not due again for 180 days',
  after.find((i) => i.ref === 'inventori-kepribadian')?.due === true /* same day: may still correct */ &&
  after.find((i) => i.ref === 'inventori-kepribadian')?.next_due === sql(`select ((now() at time zone '${TZ}')::date + 180)::text`));

// --- Topics, coverage, impact --------------------------------------------------------------------------
res = await user.rest('/topics');
check('topic labels for users', res.status === 200 && ['rokok', 'stres_kerja', 'tidur', 'kecemasan'].every((id) => res.body.data.some((t) => t.id === id && t.label)), JSON.stringify(res.body?.data));
sql("insert into ai_staff_roles (psychologist_id, role, granted_by) values ('PSY-REV','clinical_reviewer','e2e') on conflict do nothing");
const rev = new Client(B, tokens['PSY-REV']);
const psy = new Client(A, tokens['PSY-TEST']);
res = await rev.rest('/review/coverage');
const tidur = res.body?.data?.topics?.find((t) => t.topic === 'tidur');
check('coverage: per topic, approved vs draft content and what is missing',
  res.status === 200 && tidur?.routine_items?.draft === 2 && tidur.ready === false && tidur.missing.includes('label') && res.body.data.personas.active_draft >= 1,
  JSON.stringify(tidur));
check('coverage needs the reviewer role', (await psy.rest('/review/coverage')).status === 403);
check('users cannot read coverage', (await user.rest('/review/coverage')).status === 403);
res = await rev.rest('/review/impact?days=1');
const selfChecks = res.body?.data?.self_checks;
check('impact counts check-ins, screenings, inventories, and flagged answers — never scores',
  selfChecks?.checkin >= 1 && selfChecks.screening >= 2 && selfChecks.personality >= 1 && selfChecks.flagged >= 1 &&
  !JSON.stringify(res.body).includes('itest') && !JSON.stringify(selfChecks).includes('score'),
  JSON.stringify(selfChecks));

// --- User control and account lifecycle -------------------------------------------------------------
const otherId = sql("select id from ai_instrument_responses where user_id = 'itest-p8-a' limit 1");
const del = new Client(A, tokens['itest-p8-del']);
await del.ready();
check('another user cannot delete an entry', (await del.rest(`/instruments/responses/${otherId}`, { method: 'DELETE' })).status === 404 && count(`id = '${otherId}'`) === 1);
check('the owner deletes one entry', (await user.rest(`/instruments/responses/${otherId}`, { method: 'DELETE' })).status === 204 && count(`id = '${otherId}'`) === 0);
res = await user.rest('/instruments/responses', { method: 'DELETE' });
check('the owner deletes all their check-in data', res.status === 200 && res.body.data.deleted >= 1 && count("user_id = 'itest-p8-a'") === 0, JSON.stringify(res.body));

await submit(del, 'checkin-harian', CHECKIN);
let hook = await fetch(`${A}/v1/internal/users/itest-p8-del/delete`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-ai-gateway-token': INBOUND }, body: JSON.stringify({ event_id: 'itest-p8-del-1' }),
});
check('account deletion removes check-in data', hook.status === 200 && count("user_id = 'itest-p8-del'") === 0);

const from = new Client(A, tokens['itest-p8-from']);
const to = new Client(B, tokens['itest-p8-to']);
await Promise.all([from.ready(), to.ready()]);
await submit(from, 'checkin-harian', { ...CHECKIN, suasana: 1 });
await submit(from, 'skrining-draft', SCREEN_OK);
await submit(to, 'checkin-harian', { ...CHECKIN, suasana: 5 });
hook = await fetch(`${B}/v1/internal/users/merge`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-ai-gateway-token': INBOUND },
  body: JSON.stringify({ event_id: 'itest-p8-merge-1', from: 'itest-p8-from', to: 'itest-p8-to' }),
});
check('merge moves check-in data; on the same day the surviving account\'s answer stays',
  hook.status === 200 && count("user_id = 'itest-p8-from'") === 0 && count("user_id = 'itest-p8-to'") === 2 &&
  count("user_id = 'itest-p8-to' and instrument_ref = 'checkin-harian'") === 1);
res = await to.rest(`/instruments/checkin-harian/responses?days=1&tz=${encodeURIComponent(TZ)}`);
check('…and the surviving answer still decrypts (AAD = row ID)', res.body?.data?.points?.[0]?.answers?.suasana === 5, JSON.stringify(res.body));
res = await to.rest(`/instruments/skrining-draft/responses?days=1&tz=${encodeURIComponent(TZ)}`);
check('…moved rows decrypt for the new owner', res.body?.data?.points?.length === 1);

sql("delete from ai_content_versions where author_id = 'seed:e2e' and kind = 'assessment_mapping' and ref_id = 'kecemasan'");
for (const c of [user, noConsent, rev, psy, del, from, to]) c.close();
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
