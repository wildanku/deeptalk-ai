// Phase 9: consent for earlier counseling chats, the psikolog addendum, approval gates, and the
// training-data pipeline (collect → de-identify → review → staged export → withdrawal).
// Synthetic data only: the "legacy" file is written here, never read from chat-service.
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { A, B, Client, STATE, check, failures, secret, sleep, sql, tokens as loadTokens } from './lib.mjs';
const tokens = loadTokens();
const INBOUND = secret('inbound');
const GATEWAY = new URL('../gateway/', import.meta.url).pathname;
const CRISIS = 'kadang aku pengen mati aja rasanya';
const PHONE = '081298765432';
const EMAIL = 'rani.uji@contoh.id';

/** Runs a gateway script against the e2e database with the gateway's message key. */
function script(name, args, extra = {}) {
  try {
    const out = execFileSync('pnpm', ['run', '-s', name, '--', ...args], {
      cwd: GATEWAY,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        DATABASE_URL: process.env.E2E_DATABASE_URL,
        MESSAGE_LOCAL_KEY: secret('msgkey'),
        MESSAGE_KMS_KEY: '',
        DATASET_DEID: 'local',
        CONTENT_ALLOW_DRAFT: 'true',
        ...extra,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
    return { ok: true, out };
  } catch (error) {
    return { ok: false, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}
const json = (out) => JSON.parse(out.slice(out.indexOf('{')));
const ON = { DATASET_ENABLED: 'true' };
const count = (where) => Number(sql(`select count(*) from ai_dataset_items where ${where}`));

const a = new Client(A, tokens['itest-p9-a']);
const b = new Client(B, tokens['itest-p9-b']);
const crisis = new Client(A, tokens['itest-p9-crisis']);
const psikolog = new Client(B, tokens['PSY-P9']);
const dataReviewer = new Client(A, tokens['PSY-DATA']);
const clinical = new Client(B, tokens['PSY-REV']);
await Promise.all([a.ready(), b.ready(), crisis.ready()]);

// --- Consent for earlier counseling chats --------------------------------------------------------
let res = await a.rest('/me/consents');
const legacyState = res.body?.data?.legacy_counseling;
check('consent view includes earlier counseling chats, not agreed by default',
  legacyState?.text?.version === 1 && legacyState.granted === false && legacyState.decided === false, JSON.stringify(legacyState));
res = await a.rest('/me/consents', { method: 'POST', body: JSON.stringify({ type: 'legacy_counseling', text_version: 1, granted: true }) });
check('user agrees to the use of earlier counseling chats', res.body?.data?.granted === true, JSON.stringify(res.body));
for (const [client, type] of [[a, 'ai_training'], [crisis, 'ai_training']]) {
  await client.rest('/me/consents', { method: 'POST', body: JSON.stringify({ type, text_version: 1, granted: true }) });
}

// --- Psikolog addendum -----------------------------------------------------------------------------
res = await psikolog.rest('/psikolog/data-consent');
check('addendum starts with nothing allowed', res.body?.data?.text?.version === 1 && res.body.data.current === false &&
  Object.values(res.body.data.allows).every((v) => v === false), JSON.stringify(res.body));
res = await psikolog.rest('/psikolog/data-consent', { method: 'POST', body: JSON.stringify({ text_version: 99, allow_evaluation: true, allow_style_examples: true, allow_training: true }) });
check('agreeing to a text the psikolog did not see is refused', res.status === 409);
res = await psikolog.rest('/psikolog/data-consent', { method: 'POST', body: JSON.stringify({ text_version: 1, allow_evaluation: true, allow_style_examples: false, allow_training: false }) });
check('psikolog allows evaluation only', res.body?.data?.allows?.allow_evaluation === true && res.body.data.allows.allow_style_examples === false, JSON.stringify(res.body));
check('users cannot call the psikolog addendum', (await a.rest('/psikolog/data-consent')).status === 403);

// --- Conversations (synthetic) ---------------------------------------------------------------------
await a.turn(`aku susah tidur, kalau mau ngobrol nomorku ${PHONE} atau ${EMAIL}`);
await a.turn('makasih ya');
await b.turn('aku lagi stres kerja');
await crisis.turn(CRISIS);
sql("update ai_sessions set status = 'ended', end_reason = 'completed', ended_at = now() where user_id in ('itest-p9-a','itest-p9-b','itest-p9-crisis')");
check('setup: training consent set only where agreed; crisis session marked',
  sql("select exclude_from_training from ai_sessions where user_id = 'itest-p9-a'") === 'f' &&
  sql("select exclude_from_training from ai_sessions where user_id = 'itest-p9-b'") === 't' &&
  sql("select max_risk_level from ai_sessions where user_id = 'itest-p9-crisis'") === 'crisis');

// --- Gates: nothing runs ahead of a legitimate approval ----------------------------------------------
let run = script('dataset', ['collect']);
check('collect refuses while the switch is off and no gate is recorded', !run.ok && /DATASET_ENABLED/.test(run.out) && /dpia/.test(run.out) && count("user_id like 'itest-p9%'") === 0, run.out);
run = script('dataset', ['collect'], ON);
check('switch alone is not enough: DPIA and ethics review are required', !run.ok && /dpia, ethics_review/.test(run.out) && !/DATASET_ENABLED/.test(run.out), run.out);
run = script('data:gate', ['dpia', '--by', 'e2e-hukum']);
check('a gate cannot be recorded without a reference', !run.ok);
script('data:gate', ['dpia', '--by', 'e2e-hukum', '--ref', 'E2E-DPIA-1']);
script('data:gate', ['ethics_review', '--by', 'e2e-etik', '--ref', 'E2E-ETIK-1']);
run = script('data:gate', ['status']);
check('gate register shows who recorded which approval', /OPEN\s+dpia — e2e-hukum, E2E-DPIA-1/.test(run.out) && /CLOSED\s+fine_tuning_go/.test(run.out), run.out);

// --- Collect from Teman AI -------------------------------------------------------------------------
run = script('dataset', ['collect'], ON);
const collected = run.ok ? json(run.out) : null;
check('collect takes only sessions with training consent, never crisis', collected?.collected === 1 &&
  count("user_id = 'itest-p9-a' and source = 'teman_ai'") === 1 && count("user_id in ('itest-p9-b','itest-p9-crisis')") === 0, run.out);
check('…stored de-identified and encrypted; findings are counts only',
  sql(`select position('${PHONE}' in encode(content_ciphertext, 'escape')) from ai_dataset_items where user_id = 'itest-p9-a'`) === '0' &&
  JSON.parse(sql("select deid_findings from ai_dataset_items where user_id = 'itest-p9-a'")).PHONE_NUMBER === 1 &&
  !sql("select deid_findings::text from ai_dataset_items where user_id = 'itest-p9-a'").includes(PHONE));
run = script('dataset', ['collect'], ON);
check('collect is idempotent', run.ok && json(run.out).collected === 0 && count("user_id = 'itest-p9-a'") === 1, run.out);

// --- Import earlier counseling chats from an extraction file (synthetic) ----------------------------
const file = `${STATE}/legacy-e2e.jsonl`;
writeFileSync(file, [
  { conversation_id: 'E2E-L1', user_id: 'itest-p9-a', psychologist_id: 'PSY-P9', messages: [{ role: 'user', text: `halo, aku Rani, WA ${PHONE}` }, { role: 'psikolog', text: 'terima kasih sudah bercerita' }] },
  { conversation_id: 'E2E-L2', user_id: 'itest-p9-b', psychologist_id: 'PSY-P9', messages: [{ role: 'user', text: 'halo' }] },
  { conversation_id: 'E2E-L3', user_id: 'itest-p9-a', psychologist_id: 'PSY-NOPE', messages: [{ role: 'user', text: 'halo' }] },
  { conversation_id: 'E2E-L4', messages: [] },
].map((r) => JSON.stringify(r)).join('\n'));
run = script('dataset', ['import-legacy', file], ON);
check('legacy import: only users who agreed and psikolog who allow a use; silence is not consent',
  run.ok && JSON.stringify(json(run.out)) === JSON.stringify({ imported: 1, invalid: 1, no_user_consent: 1, no_psikolog_consent: 1, already: 0 }), run.out);
rmSync(file);

// --- Manual review -------------------------------------------------------------------------------------
check('dataset review needs the data_reviewer role (clinical reviewers too)', (await clinical.rest('/review/dataset')).status === 403);
sql("insert into ai_staff_roles (psychologist_id, role, granted_by) values ('PSY-DATA','data_reviewer','e2e') on conflict do nothing");
res = await dataReviewer.rest('/review/dataset/summary');
check('reviewer summary shows the gates and counts', res.body?.data?.gates?.find((g) => g.gate === 'dpia')?.approved === true &&
  res.body.data.items.reduce((sum, i) => sum + i.count, 0) === 2, JSON.stringify(res.body?.data));
res = await dataReviewer.rest('/review/dataset?status=pending_review');
const pending = res.body?.data?.items ?? [];
check('pending items listed without user identity', pending.length === 2 && !JSON.stringify(res.body).includes('itest'), JSON.stringify(res.body));
const legacyItem = pending.find((i) => i.source === 'legacy');
const temanItem = pending.find((i) => i.source === 'teman_ai');
res = await dataReviewer.rest(`/review/dataset/${legacyItem?.id}`);
check('reviewer reads de-identified text only', res.body?.data?.turns?.[0]?.text.includes('[PHONE_NUMBER]') && !JSON.stringify(res.body).includes(PHONE) && !JSON.stringify(res.body).includes('itest'), JSON.stringify(res.body?.data?.turns));
for (const item of [legacyItem, temanItem]) {
  await dataReviewer.rest(`/review/dataset/${item?.id}`, { method: 'PATCH', body: JSON.stringify({ decision: 'approved', review_notes: 'identitas tersamarkan (uji)' }) });
}
check('reviewed items approved', count("user_id = 'itest-p9-a' and status = 'approved'") === 2);

// --- Staged export ---------------------------------------------------------------------------------------
const out = `${STATE}/export-e2e.jsonl`;
rmSync(out, { force: true });
run = script('dataset', ['export', '--purpose', 'evaluation', '--out', out, '--by', 'e2e'], ON);
const exported = run.ok ? readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
check('evaluation export: both items, no user or psikolog identity in the file', exported.length === 2 &&
  !readFileSync(out, 'utf8').includes('itest') && !readFileSync(out, 'utf8').includes('PSY-') && !readFileSync(out, 'utf8').includes(PHONE), run.out);
check('…recorded in the audit trail with counts only', Number(sql("select count(*) from ai_dataset_exports where exported_by = 'e2e' and purpose = 'evaluation' and item_count = 2")) === 1);
rmSync(out, { force: true });
run = script('dataset', ['export', '--purpose', 'style_examples', '--out', out, '--by', 'e2e'], ON);
check('style examples: nothing, because neither psikolog allows that use', run.ok && json(run.out).items === 0 && json(run.out).skipped.psikolog_refused === 2, run.out);
rmSync(out, { force: true });
run = script('dataset', ['export', '--purpose', 'fine_tuning', '--out', out, '--by', 'e2e'], ON);
check('fine-tuning refused without its own gate', !run.ok && /fine_tuning_go/.test(run.out), run.out);

// --- Withdrawal and deletion ---------------------------------------------------------------------------
await a.rest('/me/consents', { method: 'POST', body: JSON.stringify({ type: 'ai_training', text_version: 1, granted: false }) });
check('revoking training consent withdraws the exported Teman AI item (content deleted, audit kept)',
  count("user_id = 'itest-p9-a' and source = 'teman_ai' and status = 'withdrawn' and content_ciphertext is null") === 1);
await a.rest('/me/consents', { method: 'POST', body: JSON.stringify({ type: 'legacy_counseling', text_version: 1, granted: false }) });
check('revoking the legacy consent withdraws the legacy item', count("user_id = 'itest-p9-a' and source = 'legacy' and status = 'withdrawn' and content_ciphertext is null") === 1);
const hook = await fetch(`${A}/v1/internal/users/itest-p9-a/delete`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-ai-gateway-token': INBOUND }, body: JSON.stringify({ event_id: 'itest-p9-del-1' }),
});
check('account deletion removes every dataset row of the user', hook.status === 200 && count("user_id = 'itest-p9-a'") === 0);
check('…the export audit stays, without user IDs', Number(sql("select count(*) from ai_dataset_exports where exported_by = 'e2e'")) >= 2 &&
  !sql("select string_agg(manifest::text, ' ') from ai_dataset_exports where exported_by = 'e2e'").includes('itest'));

// --- Closing a gate stops everything again ------------------------------------------------------------
script('data:gate', ['ethics_review', '--by', 'e2e-etik', '--ref', 'E2E-ETIK-REVOKE', '--revoke']);
run = script('dataset', ['collect'], ON);
check('revoking a gate stops collection immediately', !run.ok && /ethics_review/.test(run.out), run.out);

rmSync(out, { force: true });
await sleep(100);
for (const c of [a, b, crisis, psikolog, dataReviewer, clinical]) c.close();
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
