import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FEEDBACK_MARKER = '<!-- owner-feedback:v1 -->';
const PROCESSING_MARKER = '<!-- owner-processing:v1 -->';
const DECISIONS = new Set(['ACCEPT', 'KEEP_CURRENT', 'ADJUST_PROPOSAL', 'UNDECIDED']);
const PROCESSING = new Set(['ACKNOWLEDGED', 'PROPOSAL_UPDATED', 'PRODUCTION_ACCEPTED', 'CONTROL_CHANGE_PROPOSAL']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOGIN = /^[a-z\d](?:[a-z\d-]{0,38})$/i;
const ID = /^[a-z][a-z0-9-]{0,99}$/;
const DECISION_ID = /^github-issue:[1-9]\d*$/;
const exactKeys = (value, required, optional = []) => value && typeof value === 'object' && !Array.isArray(value)
  && required.every((key) => Object.hasOwn(value, key))
  && Object.keys(value).every((key) => [...required, ...optional].includes(key));
const integer = (value) => Number.isSafeInteger(value) && value > 0;
const timestamp = (value) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) => JSON.stringify(value, Object.keys(value).sort());
const text = (value, max) => typeof value === 'string' && value.length <= max && !value.includes('\u0000');
const allowed = (login, config) => typeof login === 'string' && LOGIN.test(login) && config.ownerLogins.some((owner) => owner.toLowerCase() === login.toLowerCase());
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

export function validateConfig(config) {
  if (!config || !/^[a-z\d-]+\/[a-z\d_.-]+$/i.test(config.repository ?? '')
    || !Array.isArray(config.ownerLogins) || !config.ownerLogins.length || !config.ownerLogins.every((login) => LOGIN.test(login))
    || !ID.test(config.pageId ?? '') || !integer(config.pageRevision) || !Array.isArray(config.modules) || !config.modules.length) {
    throw new Error('INVALID_OWNER_CONFIG');
  }
  const ids = new Set();
  for (const module of config.modules) {
    if (!ID.test(module.moduleId ?? '') || !text(module.panelId, 100) || !module.panelId
      || !text(module.title, 300) || !module.title || !text(module.recommendation, 10000)
      || !integer(module.proposalRevision) || ids.has(module.moduleId)) throw new Error('INVALID_OWNER_MODULE_CONFIG');
    ids.add(module.moduleId);
  }
  return config;
}

export function parseMarkedJson(body, marker) {
  if (!text(body, 16000)) return { error: 'INVALID_BODY' };
  const start = body.indexOf(marker);
  if (start < 0) return { error: 'NO_MARKER' };
  if (body.indexOf(marker, start + marker.length) >= 0) return { error: 'AMBIGUOUS_MARKER' };
  const match = /^\s*```json\s*\r?\n([\s\S]*?)\r?\n```(?:\s|$)/.exec(body.slice(start + marker.length));
  if (!match) return { error: 'INVALID_JSON_FENCE' };
  try { return { value: JSON.parse(match[1]) }; } catch { return { error: 'INVALID_JSON' }; }
}

export function validateFeedback(value, config, { revisions = true } = {}) {
  const keys = ['schema_version', 'page', 'module_id', 'page_revision', 'proposal_revision', 'decision', 'comment', 'expected_latest_decision_id', 'client_request_id'];
  if (!exactKeys(value, keys, ['validation_only']) || (Object.hasOwn(value, 'validation_only') && typeof value.validation_only !== 'boolean')
    || value.schema_version !== 1 || value.page !== config.pageId || !ID.test(value.module_id ?? '')
    || !integer(value.page_revision) || !integer(value.proposal_revision) || !DECISIONS.has(value.decision)
    || !text(value.comment, 2000) || !UUID.test(value.client_request_id ?? '')
    || !(value.expected_latest_decision_id === null || DECISION_ID.test(value.expected_latest_decision_id ?? ''))) return 'INVALID_FEEDBACK';
  const module = config.modules.find((entry) => entry.moduleId === value.module_id);
  if (!module) return 'UNKNOWN_MODULE';
  if (revisions && value.page_revision !== config.pageRevision) return 'STALE_PAGE_REVISION';
  if (revisions && value.proposal_revision !== module.proposalRevision) return 'STALE_PROPOSAL_REVISION';
  return null;
}

export function validateProcessing(value, config) {
  if (!exactKeys(value, ['decision_id', 'status', 'comment'], ['evidence_url']) || !DECISION_ID.test(value.decision_id ?? '')
    || !PROCESSING.has(value.status) || !text(value.comment, 2000)) return 'INVALID_PROCESSING';
  if (value.evidence_url !== undefined) {
    try {
      const url = new URL(value.evidence_url);
      if (!text(value.evidence_url, 2000) || url.protocol !== 'https:' || url.username || url.password) return 'INVALID_EVIDENCE_URL';
    } catch { return 'INVALID_EVIDENCE_URL'; }
  }
  if (value.status === 'PRODUCTION_ACCEPTED' && !value.evidence_url) return 'PRODUCTION_EVIDENCE_REQUIRED';
  return null;
}

// Only the GitHub delivery envelope provides author, actor, entity IDs and times.
// Never import identity, timestamps or processing status from feedback JSON.
export function eventFromGitHub(payload, eventName, config, { original = false } = {}) {
  validateConfig(config);
  if (payload.repository?.full_name?.toLowerCase() !== config.repository.toLowerCase()) throw new Error('REPOSITORY_MISMATCH');
  if (!['issues', 'issue_comment'].includes(eventName) || payload.issue?.pull_request) return null;
  const kind = eventName === 'issues' ? 'DECISION' : 'PROCESSING';
  const validActions = kind === 'DECISION' ? ['opened', 'edited'] : ['created', 'edited'];
  if (!validActions.includes(payload.action)) return null;
  const issue = payload.issue;
  const entity = kind === 'DECISION' ? issue : payload.comment;
  if (!integer(issue?.number) || !integer(entity?.id) || !timestamp(entity.created_at)
    || !timestamp(entity.updated_at ?? entity.created_at) || !LOGIN.test(entity.user?.login ?? '')
    || !LOGIN.test(payload.sender?.login ?? '')) throw new Error('INVALID_GITHUB_ENVELOPE');
  const body = original ? payload.changes?.body?.from : entity.body;
  if (typeof body !== 'string') return null;
  const marker = kind === 'DECISION' ? FEEDBACK_MARKER : PROCESSING_MARKER;
  const parsed = parseMarkedJson(body, marker);
  if (parsed.error === 'NO_MARKER') return null;
  const action = original ? 'snapshot' : payload.action;
  const occurredAt = ['opened', 'created'].includes(action) ? entity.created_at : entity.updated_at;
  const metadata = {
    schema_version: 1, repository: config.repository, kind, action, issue_number: issue.number,
    entity_id: entity.id, author: entity.user.login, actor: payload.sender.login,
    created_at: entity.created_at, occurred_at: occurredAt,
    body_sha256: hash(body), ...(original ? { snapshot_before_edit: true } : {}),
  };
  const identity = { kind, action, issue_number: issue.number, entity_id: entity.id,
    occurred_at: occurredAt, body_sha256: metadata.body_sha256 };
  const event = { ...metadata, event_id: `github-${hash(canonical(identity))}` };
  let error = !allowed(entity.user.login, config) || !allowed(payload.sender.login, config) ? 'NON_OWNER' : parsed.error;
  if (!error) error = kind === 'DECISION' ? validateFeedback(parsed.value, config) : validateProcessing(parsed.value, config);
  if (error) return { ...event, validation_error: error,
    ...(['UNKNOWN_MODULE', 'STALE_PAGE_REVISION', 'STALE_PROPOSAL_REVISION'].includes(error) ? { payload: parsed.value } : {}) };
  return { ...event, payload: parsed.value, config_snapshot: { page: config.pageId, page_revision: config.pageRevision,
    ...(kind === 'DECISION' ? { module_id: parsed.value.module_id, proposal_revision: config.modules.find((module) => module.moduleId === parsed.value.module_id).proposalRevision } : {}) } };
}

export function emptyProjection(config) {
  validateConfig(config);
  return { schema_version: 1, generated_at: null, repository: config.repository, page: config.pageId,
    page_revision: config.pageRevision, modules: config.modules, entries: [], history: [], current: [], conflicts: [] };
}

export function projectEvents(events, config) {
  const projection = emptyProjection(config);
  const current = new Map();
  const requestIds = new Map();
  const decisions = new Map();
  const seen = new Set();
  const ordered = [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)
    || a.issue_number - b.issue_number || (a.kind === 'DECISION' ? 0 : 1) - (b.kind === 'DECISION' ? 0 : 1)
    || a.entity_id - b.entity_id || ({ opened: 0, created: 0, snapshot: 1, edited: 2 }[a.action] ?? 3) - ({ opened: 0, created: 0, snapshot: 1, edited: 2 }[b.action] ?? 3)
    || a.event_id.localeCompare(b.event_id));
  for (const event of ordered) {
    if (seen.has(event.event_id)) continue;
    seen.add(event.event_id);
    const base = { event_id: event.event_id, sequence: event.sequence, kind: event.kind, action: event.action,
      issue_number: event.issue_number, author: event.author, actor: event.actor,
      created_at: event.created_at, occurred_at: event.occurred_at,
      ...(event.snapshot_before_edit ? { snapshot_before_edit: true } : {}) };
    const reject = (code, outcome = 'REJECTED', extra = {}) => {
      const entry = { ...base, ...(event.payload ?? {}), outcome, code, ...extra };
      projection.history.push(entry);
      if (outcome === 'CONFLICT') projection.conflicts.push(entry);
    };
    if (event.validation_error) { reject(event.validation_error, event.validation_error.startsWith('STALE_') ? 'CONFLICT' : 'REJECTED'); continue; }
    if (!event.payload || event.repository !== config.repository || !allowed(event.author, config) || !allowed(event.actor, config)) { reject('INVALID_ARCHIVED_EVENT'); continue; }
    if (event.action === 'snapshot') { reject('PRE_EDIT_SNAPSHOT', 'SNAPSHOT'); continue; }
    if (event.action === 'edited') { reject('NEW_ISSUE_REQUIRED', 'EDIT_RECORDED'); continue; }
    if (event.kind === 'PROCESSING') {
      const code = validateProcessing(event.payload, config);
      if (code) { reject(code); continue; }
      const target = decisions.get(event.payload.decision_id);
      if (!target || target.issue_number !== event.issue_number) { reject('UNKNOWN_DECISION'); continue; }
      const receipt = { ...base, ...event.payload, outcome: 'ACCEPTED' };
      target.processing.push(receipt);
      target.status = event.payload.status;
      projection.history.push(receipt);
      continue;
    }
    const code = validateFeedback(event.payload, config, { revisions: false });
    if (code) { reject(code); continue; }
    const feedback = event.payload;
    if (feedback.validation_only === true) {
      reject('VALIDATION_ONLY', 'VALIDATION', { decision_id: `github-issue:${event.issue_number}` });
      continue;
    }
    const fingerprint = hash(canonical(feedback));
    const requestId = feedback.client_request_id.toLowerCase();
    const duplicate = requestIds.get(requestId);
    if (duplicate) {
      reject(duplicate.fingerprint === fingerprint ? 'DUPLICATE_REQUEST' : 'CLIENT_REQUEST_ID_CONFLICT',
        duplicate.fingerprint === fingerprint ? 'DUPLICATE' : 'CONFLICT', { original_decision_id: duplicate.decision_id });
      continue;
    }
    const decisionId = `github-issue:${event.issue_number}`;
    requestIds.set(requestId, { fingerprint, decision_id: decisionId });
    if (decisions.has(decisionId)) { reject('ISSUE_ALREADY_RECORDED', 'CONFLICT'); continue; }
    const latest = current.get(feedback.module_id);
    if ((latest?.decision_id ?? null) !== feedback.expected_latest_decision_id) {
      reject('LATEST_DECISION_CONFLICT', 'CONFLICT', { decision_id: decisionId, latest_decision_id: latest?.decision_id ?? null });
      continue;
    }
    const entry = { ...base, ...feedback, decision_id: decisionId, outcome: 'ACCEPTED', status: 'OPEN', processing: [] };
    decisions.set(decisionId, entry);
    current.set(feedback.module_id, entry);
    projection.history.push(entry);
  }
  projection.current = config.modules.flatMap((module) => {
    const entry = current.get(module.moduleId);
    if (!entry) return [];
    entry.stale = entry.page_revision !== config.pageRevision || entry.proposal_revision !== module.proposalRevision;
    return [entry];
  });
  // Both names are intentionally supported for the public client contract.
  projection.entries = projection.history;
  projection.generated_at = ordered.at(-1)?.occurred_at ?? null;
  return projection;
}

export async function loadEvents(directory) {
  let names;
  try { names = await readdir(directory); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const events = [];
  for (const name of names.sort()) {
    if (!/^github-[a-f0-9]{64}\.json$/.test(name)) continue;
    const value = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
    if (value.event_id !== name.slice(0, -5) || !integer(value.sequence)) throw new Error('INVALID_EVENT_ARCHIVE');
    events.push(value);
  }
  if (new Set(events.map((event) => event.sequence)).size !== events.length) throw new Error('DUPLICATE_EVENT_SEQUENCE');
  return events;
}

export async function appendEvent(directory, event) {
  await mkdir(directory, { recursive: true });
  const events = await loadEvents(directory);
  const existing = events.find((item) => item.event_id === event.event_id);
  if (existing) return { event: existing, appended: false };
  const archived = { ...event, sequence: Math.max(0, ...events.map((item) => item.sequence)) + 1 };
  // wx fails if a retry would overwrite an existing event. Serialized Actions
  // prevent sequence races; the commit script retries from remote before append.
  await writeFile(path.join(directory, `${event.event_id}.json`), json(archived), { flag: 'wx' });
  return { event: archived, appended: true };
}

export async function processDelivery({ root, payload, eventName }) {
  const config = validateConfig(JSON.parse(await readFile(path.join(root, 'source/owner-control.config.json'), 'utf8')));
  const directory = path.join(root, 'ledger/events');
  const events = await loadEvents(directory);
  let appended = 0;
  // GitHub includes the immediate pre-edit body. Archive it separately without
  // promoting it: after multiple missed edits it need not be the original.
  if (payload?.action === 'edited') {
    const original = eventFromGitHub(payload, eventName, config, { original: true });
    if (original) {
      const result = await appendEvent(directory, original);
      appended += Number(result.appended);
    }
  }
  const event = eventFromGitHub(payload, eventName, config);
  if (event) appended += Number((await appendEvent(directory, event)).appended);
  const projection = projectEvents(await loadEvents(directory), config);
  await mkdir(path.join(root, 'ledger'), { recursive: true });
  await writeFile(path.join(root, 'ledger/decisions.json'), json(projection), 'utf8');
  return { appended, projection };
}

export async function rebuild(root) {
  const config = validateConfig(JSON.parse(await readFile(path.join(root, 'source/owner-control.config.json'), 'utf8')));
  const projection = projectEvents(await loadEvents(path.join(root, 'ledger/events')), config);
  await mkdir(path.join(root, 'ledger'), { recursive: true });
  await writeFile(path.join(root, 'ledger/decisions.json'), json(projection), 'utf8');
  return projection;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  if (process.argv.includes('--rebuild')) {
    await rebuild(root);
  } else {
    const eventName = process.env.GITHUB_EVENT_NAME;
    if (!process.env.GITHUB_EVENT_PATH) throw new Error('GITHUB_EVENT_PATH_REQUIRED');
    const payload = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const result = await processDelivery({ root, payload, eventName });
    console.log(JSON.stringify({ appended: result.appended, decisions: result.projection.current.length, conflicts: result.projection.conflicts.length }));
  }
}
