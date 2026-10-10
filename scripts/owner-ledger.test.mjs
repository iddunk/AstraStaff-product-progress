import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendEvent, eventFromGitHub, loadEvents, parseMarkedJson, processDelivery, projectEvents, validateConfig } from './owner-ledger.mjs';
import { assertAppendOnly } from './publish-owner-ledger.mjs';

const config = { repository: 'iddunk/AstraStaff-product-progress', ownerLogins: ['iddunk'], pageId: 'product-experience-review', pageRevision: 3,
  modules: [{ moduleId: 'employee-home', panelId: 'A', title: 'Employee Home', recommendation: 'Keep a clear main path', proposalRevision: 2 }] };
const testRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.test-tmp');
async function testTemp(prefix) {
  await mkdir(testRoot, { recursive: true });
  return mkdtemp(path.join(testRoot, prefix));
}
const uuid = (n) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const feedback = (n, extra = {}) => ({ schema_version: 1, page: config.pageId, module_id: 'employee-home', page_revision: 3,
  proposal_revision: 2, decision: 'ACCEPT', comment: 'Owner direction', expected_latest_decision_id: null, client_request_id: uuid(n), ...extra });
const body = (data, marker = 'owner-feedback') => `<!-- ${marker}:v1 -->\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\`\n`;
const envelope = (n, data = feedback(n), extra = {}) => ({ repository: { full_name: config.repository }, action: 'opened', sender: { login: 'iddunk' },
  issue: { number: n, id: 100 + n, user: { login: 'iddunk' }, created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z', body: body(data) }, ...extra });
const event = (n, data = feedback(n), extra = {}) => ({ ...eventFromGitHub(envelope(n, data, extra), 'issues', config), sequence: n });
async function fixture() {
  const root = await testTemp('owner-ledger-test-');
  await mkdir(path.join(root, 'source'));
  await writeFile(path.join(root, 'source/owner-control.config.json'), JSON.stringify(config));
  return root;
}

test('valid owner issue derives identity and initial OPEN decision from GitHub', () => {
  const result = projectEvents([event(1)], config);
  assert.equal(result.current[0].decision_id, 'github-issue:1');
  assert.equal(result.current[0].author, 'iddunk');
  assert.equal(result.current[0].status, 'OPEN');
  assert.equal(result.current[0].outcome, 'ACCEPTED');
});

test('validation probe reads back in history and never becomes an Owner decision', () => {
  const result = projectEvents([event(1, feedback(1, { validation_only: true })), event(2)], config);
  assert.equal(result.history[0].outcome, 'VALIDATION');
  assert.equal(result.history[0].client_request_id, uuid(1));
  assert.equal(result.current.length, 1);
  assert.equal(result.current[0].decision_id, 'github-issue:2');
  assert.equal(result.conflicts.length, 0);
});

test('trusted source ordering is stable when concurrent deliveries commit in reverse order', () => {
  const first = { ...event(1), sequence: 2 };
  const second = { ...event(2, feedback(2, { expected_latest_decision_id: 'github-issue:1', decision: 'KEEP_CURRENT' })), sequence: 1 };
  const result = projectEvents([second, first], config);
  assert.equal(result.current[0].decision_id, 'github-issue:2');
  assert.equal(result.conflicts.length, 0);
});

test('feedback body cannot forge author, IDs, processing status or arbitrary payload', () => {
  for (const extra of [{ author: 'iddunk' }, { decision_id: 'github-issue:999' }, { status: 'PRODUCTION_ACCEPTED' }, { __proto__: null, shell: '$(rm -rf /)' }]) {
    assert.equal(event(1, feedback(1, extra)).validation_error, 'INVALID_FEEDBACK');
  }
});

test('non-owner author and non-owner edit actor fail closed without storing raw body', () => {
  const input = envelope(1);
  input.issue.user.login = 'attacker';
  input.issue.body = body(feedback(1, { comment: 'public raw text' }));
  const denied = eventFromGitHub(input, 'issues', config);
  assert.equal(denied.validation_error, 'NON_OWNER');
  assert.equal(denied.payload, undefined);
  assert.ok(!JSON.stringify(denied).includes('public raw text'));
  input.issue.user.login = 'iddunk'; input.sender.login = 'attacker';
  assert.equal(eventFromGitHub(input, 'issues', config).validation_error, 'NON_OWNER');
});

test('unknown module, stale page/proposal and oversized input do not replace current', () => {
  for (const [extra, code] of [[{ module_id: 'other' }, 'UNKNOWN_MODULE'], [{ page_revision: 2 }, 'STALE_PAGE_REVISION'],
    [{ proposal_revision: 1 }, 'STALE_PROPOSAL_REVISION'], [{ comment: 'a'.repeat(2001) }, 'INVALID_FEEDBACK']]) {
    const input = event(2, feedback(2, extra));
    assert.equal(input.validation_error, code);
    assert.equal(projectEvents([event(1), input], config).current[0].decision_id, 'github-issue:1');
  }
});

test('concurrent stale expected ID records conflict and preserves existing direction', () => {
  const result = projectEvents([event(1), event(2, feedback(2, { decision: 'KEEP_CURRENT' }))], config);
  assert.equal(result.current[0].decision, 'ACCEPT');
  assert.equal(result.conflicts[0].code, 'LATEST_DECISION_CONFLICT');
  assert.equal(result.conflicts[0].client_request_id, uuid(2));
  const fresh = projectEvents([event(1), event(2, feedback(2, { expected_latest_decision_id: 'github-issue:1', decision: 'KEEP_CURRENT' }))], config);
  assert.equal(fresh.current[0].decision_id, 'github-issue:2');
  assert.equal(fresh.history.length, 2);
});

test('request UUID dedups identical resubmission and conflicts on changed payload', () => {
  const original = event(1);
  const duplicate = event(2, feedback(1));
  const mismatch = event(3, feedback(1, { comment: 'changed' }));
  const result = projectEvents([original, duplicate, mismatch], config);
  assert.equal(result.history[1].outcome, 'DUPLICATE');
  assert.equal(result.history[1].original_decision_id, 'github-issue:1');
  assert.equal(result.conflicts[0].code, 'CLIENT_REQUEST_ID_CONFLICT');
  assert.equal(result.current[0].comment, 'Owner direction');
});

test('archive retry is byte-stable and never overwrites an earlier event', async () => {
  const root = await fixture();
  const dir = path.join(root, 'ledger/events');
  const original = eventFromGitHub(envelope(1), 'issues', config);
  await appendEvent(dir, original);
  const before = await readFile(path.join(dir, `${original.event_id}.json`));
  const retry = await appendEvent(dir, { ...original, comment: 'attempted overwrite' });
  assert.equal(retry.appended, false);
  assert.deepEqual(await readFile(path.join(dir, `${original.event_id}.json`)), before);
  assert.equal((await readdir(dir)).length, 1);
});

test('editing preserves original opinion and appends edit history', async () => {
  const root = await fixture();
  await processDelivery({ root, payload: envelope(1), eventName: 'issues' });
  const input = envelope(1, feedback(1, { decision: 'ADJUST_PROPOSAL', comment: 'changed by edit' }));
  input.action = 'edited'; input.issue.updated_at = '2026-10-10T00:01:00Z'; input.changes = { body: { from: body(feedback(1)) } };
  const result = await processDelivery({ root, payload: input, eventName: 'issues' });
  assert.equal(result.projection.current[0].decision, 'ACCEPT');
  assert.equal(result.projection.history[1].outcome, 'SNAPSHOT');
  assert.equal(result.projection.history[2].outcome, 'EDIT_RECORDED');
  assert.equal(result.projection.history[2].comment, 'changed by edit');
  assert.equal((await loadEvents(path.join(root, 'ledger/events'))).length, 3);
});

test('pre-edit snapshot stays history-only; late opened delivery establishes original safely', async () => {
  const root = await fixture();
  const input = envelope(1, feedback(1, { decision: 'KEEP_CURRENT' }));
  input.action = 'edited'; input.issue.updated_at = '2026-10-10T00:01:00Z'; input.changes = { body: { from: body(feedback(1)) } };
  const result = await processDelivery({ root, payload: input, eventName: 'issues' });
  assert.equal(result.projection.current.length, 0);
  assert.equal(result.projection.history[0].outcome, 'SNAPSHOT');
  assert.equal(result.projection.history[1].outcome, 'EDIT_RECORDED');
  const late = await processDelivery({ root, payload: envelope(1), eventName: 'issues' });
  assert.equal(late.projection.current[0].decision, 'ACCEPT');
  assert.equal(late.projection.history.length, 3);
});

test('processing receipts update separate status without changing owner direction', () => {
  const payload = envelope(1);
  payload.action = 'created';
  payload.comment = { id: 901, user: { login: 'iddunk' }, created_at: '2026-10-10T00:02:00Z', updated_at: '2026-10-10T00:02:00Z',
    body: body({ decision_id: 'github-issue:1', status: 'PROPOSAL_UPDATED', comment: 'Proposal delivered' }, 'owner-processing') };
  const receipt = { ...eventFromGitHub(payload, 'issue_comment', config), sequence: 2 };
  const result = projectEvents([event(1), receipt], config);
  assert.equal(result.current[0].decision, 'ACCEPT');
  assert.equal(result.current[0].comment, 'Owner direction');
  assert.equal(result.current[0].status, 'PROPOSAL_UPDATED');
  assert.equal(result.current[0].processing.length, 1);
});

test('processing target must match issue and production acceptance requires HTTPS evidence', () => {
  const input = envelope(1); input.action = 'created';
  input.comment = { id: 901, user: { login: 'iddunk' }, created_at: '2026-10-10T00:02:00Z', body: body({ decision_id: 'github-issue:2', status: 'ACKNOWLEDGED', comment: '' }, 'owner-processing') };
  let receipt = { ...eventFromGitHub(input, 'issue_comment', config), sequence: 3 };
  const result = projectEvents([event(1), event(2, feedback(2, { expected_latest_decision_id: 'github-issue:1' })), receipt], config);
  assert.equal(result.history.at(-1).code, 'UNKNOWN_DECISION');
  for (const evidence of [undefined, 'javascript:alert(1)', 'https://user:password@example.com/proof']) {
    input.comment.body = body({ decision_id: 'github-issue:1', status: 'PRODUCTION_ACCEPTED', comment: '', ...(evidence ? { evidence_url: evidence } : {}) }, 'owner-processing');
    assert.ok(eventFromGitHub(input, 'issue_comment', config).validation_error);
  }
});

test('structured comments remain inert data and parsing rejects ambiguous fences', () => {
  const inert = event(1, feedback(1, { comment: '<script>alert(1)</script> $(touch /tmp/unsafe) `id`' }));
  assert.equal(projectEvents([inert], config).current[0].comment, inert.payload.comment);
  assert.equal(parseMarkedJson(body(feedback(1)) + body(feedback(2)), '<!-- owner-feedback:v1 -->').error, 'AMBIGUOUS_MARKER');
  assert.equal(parseMarkedJson('<!-- owner-feedback:v1 -->\n```json\nnot-json\n```', '<!-- owner-feedback:v1 -->').error, 'INVALID_JSON');
});

test('wrong repository, pull request and unrelated issue are not ingested', () => {
  assert.throws(() => eventFromGitHub(envelope(1, feedback(1), { repository: { full_name: 'attacker/repo' } }), 'issues', config), /REPOSITORY_MISMATCH/);
  const input = envelope(1); input.issue.pull_request = { url: 'https://github.com/' };
  assert.equal(eventFromGitHub(input, 'issues', config), null);
  delete input.issue.pull_request; input.issue.body = 'Ordinary public issue';
  assert.equal(eventFromGitHub(input, 'issues', config), null);
});

test('projection keeps an accepted unchanged proposal current after an unrelated page update', () => {
  const old = event(1);
  const result = projectEvents([old], { ...config, pageRevision: 4 });
  assert.equal(result.current[0].decision, 'ACCEPT');
  assert.equal(result.current[0].page_revision, 3);
  assert.equal(result.current[0].stale, false);
  assert.deepEqual(old, event(1));
});

test('projection retains past decisions but marks a changed module proposal stale', () => {
  const old = event(1);
  const result = projectEvents([old], { ...config, pageRevision: 4, modules: [{ ...config.modules[0], proposalRevision: 3 }] });
  assert.equal(result.current[0].page_revision, 3);
  assert.equal(result.current[0].proposal_revision, 2);
  assert.equal(result.current[0].stale, true);
});

test('config permits shared panel IDs but disallows duplicate semantic module IDs', () => {
  assert.equal(validateConfig({ ...config, modules: [...config.modules, { ...config.modules[0], moduleId: 'daily-operation' }] }).modules.length, 2);
  assert.throws(() => validateConfig({ ...config, modules: [...config.modules, config.modules[0]] }), /INVALID_OWNER_MODULE_CONFIG/);
});

test('publish guard detects overwritten or removed committed events', async () => {
  const temp = await testTemp('owner-archive-guard-');
  const before = path.join(temp, 'before'); const after = path.join(temp, 'after');
  await mkdir(before); await mkdir(after);
  await writeFile(path.join(before, 'event.json'), 'original'); await writeFile(path.join(after, 'event.json'), 'changed');
  await assert.rejects(assertAppendOnly(before, after), /EVENT_HISTORY_OVERWRITE_FORBIDDEN/);
});
