// Portable Cloudflare Worker fetch handler. No KV, D1, durable objects, npm
// dependencies, credential logs, or business database. All truth stays GitHub.
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHOICES = new Set(['ACCEPT', 'KEEP_CURRENT', 'ADJUST_PROPOSAL', 'UNDECIDED']);
const DEFAULT_TTL = 8 * 60 * 60;
const STATE_TTL = 10 * 60;
const STATE_COOKIE = '__Host-owner-oauth-state';
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (value) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
const error = (code, status = 400) => Object.assign(new Error(code), { status });
const now = () => Math.floor(Date.now() / 1000);
const cookie = (value, maxAge) => `${STATE_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

function settings(env) {
  const config = JSON.parse(env.OWNER_CONFIG_JSON);
  const page = new URL(env.PAGES_URL);
  const callback = new URL(env.OAUTH_CALLBACK_URL);
  const basePath = env.BASE_PATH ?? '';
  const sessionTtl = Number(env.SESSION_TTL_SECONDS ?? DEFAULT_TTL);
  if (page.protocol !== 'https:' || callback.protocol !== 'https:' || page.hash || page.username || page.password
    || page.search || !/^(?:\/[a-z0-9-]+)*$/.test(basePath) || callback.pathname !== `${basePath}/auth/callback` || callback.hash || callback.search
    || !Number.isSafeInteger(sessionTtl) || sessionTtl < 300 || sessionTtl > 86400
    || !/^[a-z\d-]+\/[a-z\d_.-]+$/i.test(config.repository ?? '') || !Array.isArray(config.ownerLogins) || !config.ownerLogins.length
    || !Array.isArray(config.modules) || !Number.isSafeInteger(config.pageRevision)
    || typeof env.SESSION_SECRET !== 'string' || env.SESSION_SECRET.length < 32 || !env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) throw error('GATEWAY_CONFIG_INVALID', 503);
  return { config, page, callback, basePath, sessionTtl, branch: env.LEDGER_BRANCH ?? 'gh-pages' };
}
async function secretKey(secret, algorithm) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', bytes, algorithm, false, algorithm === 'AES-GCM' ? ['encrypt', 'decrypt'] : ['sign', 'verify']);
}
async function signedState(env, value) {
  const key = await secretKey(env.SESSION_SECRET, { name: 'HMAC', hash: 'SHA-256' });
  return `${value}.${b64(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))}`;
}
async function validState(env, input) {
  try {
    const [value, signature, extra] = input.split('.');
    if (extra || !value || !signature) return false;
    const key = await secretKey(env.SESSION_SECRET, { name: 'HMAC', hash: 'SHA-256' });
    if (!await crypto.subtle.verify('HMAC', key, unb64(signature), encoder.encode(value))) return false;
    const data = JSON.parse(decoder.decode(unb64(value)));
    return UUID.test(data.nonce) && data.expires > now() && data.expires <= now() + STATE_TTL;
  } catch { return false; }
}
async function seal(env, token, config, sessionTtl) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await secretKey(env.SESSION_SECRET, 'AES-GCM');
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(config.repository) }, key,
    encoder.encode(JSON.stringify({ token, expires: now() + sessionTtl })));
  return `${b64(iv)}.${b64(encrypted)}`;
}
async function open(env, opaque, config) {
  try {
    if (typeof opaque !== 'string' || opaque.length > 4000) throw error('SESSION_INVALID', 401);
    const [iv, ciphertext, extra] = opaque.split('.');
    if (extra || !iv || !ciphertext) throw error('SESSION_INVALID', 401);
    const key = await secretKey(env.SESSION_SECRET, 'AES-GCM');
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: encoder.encode(config.repository) }, key, unb64(ciphertext));
    const data = JSON.parse(decoder.decode(decrypted));
    if (typeof data.token !== 'string' || data.expires <= now() || data.expires > now() + 86400) throw error('SESSION_EXPIRED', 401);
    return data.token;
  } catch (cause) { throw error(cause.message === 'SESSION_EXPIRED' ? 'SESSION_EXPIRED' : 'SESSION_INVALID', 401); }
}
async function github(fetcher, token, route, options = {}) {
  let response;
  try {
    response = await fetcher(`https://api.github.com${route}`, { ...options, headers: { Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'owner-feedback-gateway', Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  } catch { throw error('GITHUB_UNAVAILABLE', 502); }
  if (!response.ok) throw error(response.status === 401 ? 'GITHUB_SESSION_REJECTED' : 'GITHUB_REQUEST_FAILED', response.status === 401 ? 401 : 502);
  try { return await response.json(); } catch { throw error('GITHUB_INVALID_RESPONSE', 502); }
}
async function identity(request, env, config, fetcher) {
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) throw error('LOGIN_REQUIRED', 401);
  const token = await open(env, auth.slice(7), config);
  const user = await github(fetcher, token, '/user');
  if (!Number.isSafeInteger(user.id) || typeof user.login !== 'string') throw error('GITHUB_INVALID_IDENTITY', 502);
  if (!config.ownerLogins.some((login) => login.toLowerCase() === user.login.toLowerCase())) throw error('OWNER_LOGIN_REQUIRED', 403);
  return { token, user };
}
function validateFeedback(value, config) {
  const required = ['schema_version', 'page', 'module_id', 'page_revision', 'proposal_revision', 'decision', 'comment', 'expected_latest_decision_id', 'client_request_id'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || !required.every((key) => Object.hasOwn(value, key))
    || !Object.keys(value).every((key) => [...required, 'validation_only'].includes(key))
    || (Object.hasOwn(value, 'validation_only') && typeof value.validation_only !== 'boolean')
    || value.schema_version !== 1 || value.page !== config.pageId || !CHOICES.has(value.decision)
    || typeof value.comment !== 'string' || value.comment.length > 2000 || value.comment.includes('\u0000')
    || !UUID.test(value.client_request_id ?? '')
    || !(value.expected_latest_decision_id === null || /^github-issue:[1-9]\d*$/.test(value.expected_latest_decision_id ?? ''))
    || !Number.isSafeInteger(value.page_revision) || !Number.isSafeInteger(value.proposal_revision)) throw error('INVALID_FEEDBACK');
  const module = config.modules.find((entry) => entry.moduleId === value.module_id);
  if (!module) throw error('UNKNOWN_MODULE');
  if (value.page_revision !== config.pageRevision || value.proposal_revision !== module.proposalRevision) throw error('STALE_REVIEW_REVISION', 409);
}

async function readLedger(fetcher, token, config, branch) {
  const result = await github(fetcher, token, `/repos/${config.repository}/contents/ledger/decisions.json?ref=${encodeURIComponent(branch)}`);
  if (result.encoding !== 'base64' || typeof result.content !== 'string') throw error('GITHUB_INVALID_LEDGER', 502);
  let ledger;
  try { ledger = JSON.parse(decoder.decode(unb64(result.content.replace(/\s/g, '')))); } catch { throw error('GITHUB_INVALID_LEDGER', 502); }
  if (ledger.repository !== config.repository || ledger.schema_version !== 1 || !Array.isArray(ledger.current)) throw error('GITHUB_INVALID_LEDGER', 502);
  return ledger;
}

export function createGateway(fetcher = fetch) {
  return {
    async fetch(request, env) {
      let options;
      const url = new URL(request.url);
      let route = url.pathname;
      const respond = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: {
        'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
        ...(options && request.headers.get('origin') === options.page.origin ? { 'Access-Control-Allow-Origin': options.page.origin, Vary: 'Origin' } : {}), ...headers } });
      try {
        options = settings(env);
        const { config, page, callback, branch, basePath, sessionTtl } = options;
        if (!url.pathname.startsWith(`${basePath}/`)) throw error('NOT_FOUND', 404);
        route = url.pathname.slice(basePath.length);
        if (url.origin !== callback.origin) throw error('GATEWAY_ORIGIN_INVALID', 403);
        if (route === '/health' && request.method === 'GET') return respond({ status: 'ready', service: 'owner-feedback-gateway' });
        if (request.method === 'OPTIONS') {
          if (request.headers.get('origin') !== page.origin) throw error('ORIGIN_FORBIDDEN', 403);
          return respond({}, 200, { 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Max-Age': '600' });
        }
        if (route === '/auth/start' && request.method === 'GET') {
          const state = await signedState(env, b64(encoder.encode(JSON.stringify({ nonce: crypto.randomUUID(), expires: now() + STATE_TTL }))));
          const target = new URL('https://github.com/login/oauth/authorize');
          target.search = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: callback.href, ...(env.GITHUB_APP_MODE === 'true' ? {} : {scope:'public_repo'}), state }).toString();
          return new Response(null, { status: 302, headers: { Location: target.href, 'Set-Cookie': cookie(state, STATE_TTL), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
        }
        if (route === '/auth/callback' && request.method === 'GET') {
          const state = url.searchParams.get('state');
          const stateCookie = request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${STATE_COOKIE}=`))?.slice(STATE_COOKIE.length + 1);
          if (!state || state !== stateCookie || !await validState(env, state)) throw error('OAUTH_STATE_INVALID', 403);
          const code = url.searchParams.get('code');
          if (!code || code.length > 1000) throw error('OAUTH_CODE_REQUIRED');
          let response;
          try { response = await fetcher('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: callback.href }) }); } catch { throw error('GITHUB_UNAVAILABLE', 502); }
          if (!response.ok) throw error('OAUTH_EXCHANGE_FAILED', 502);
          const exchange = await response.json();
          if (typeof exchange.access_token !== 'string' || exchange.token_type?.toLowerCase() !== 'bearer') throw error('OAUTH_EXCHANGE_FAILED', 502);
          const user = await github(fetcher, exchange.access_token, '/user');
          if (!Number.isSafeInteger(user.id) || !config.ownerLogins.some((login) => login.toLowerCase() === user.login?.toLowerCase())) throw error('OWNER_LOGIN_REQUIRED', 403);
          const target = new URL(page);
          target.hash = new URLSearchParams({ owner_session: await seal(env, exchange.access_token, config, sessionTtl), expires_in: String(sessionTtl) }).toString();
          return new Response(null, { status: 302, headers: { Location: target.href, 'Set-Cookie': cookie('', 0), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
        }
        if (request.headers.get('origin') !== page.origin) throw error('ORIGIN_FORBIDDEN', 403);
        const { token, user } = await identity(request, env, config, fetcher);
        if (route === '/session' && request.method === 'GET') return respond({ authenticated: true, login: user.login, id: user.id });
        if (route === '/decisions' && request.method === 'GET') return respond(await readLedger(fetcher, token, config, branch));
        if (route === '/feedback' && request.method === 'POST') {
          if (!request.headers.get('content-type')?.startsWith('application/json')) throw error('JSON_REQUIRED', 415);
          if (Number(request.headers.get('content-length') ?? 0) > 16000) throw error('PAYLOAD_TOO_LARGE', 413);
          const raw = await request.text();
          if (raw.length > 16000) throw error('PAYLOAD_TOO_LARGE', 413);
          let value;
          try { value = JSON.parse(raw); } catch { throw error('INVALID_JSON'); }
          validateFeedback(value, config);
          const ledger = await readLedger(fetcher, token, config, branch);
          if (ledger.page_revision !== config.pageRevision) throw error('GATEWAY_REVIEW_CONFIG_STALE', 409);
          const latest = ledger.current.find((entry) => entry.module_id === value.module_id);
          if (value.validation_only !== true && (latest?.decision_id ?? null) !== value.expected_latest_decision_id) throw error('LATEST_DECISION_CONFLICT', 409);
          const issue = await github(fetcher, token, `/repos/${config.repository}/issues`, { method: 'POST',
            body: JSON.stringify({ title: `${value.validation_only ? '[VALIDATION] ' : ''}Owner feedback: ${value.module_id}`, body: `<!-- owner-feedback:v1 -->\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n` }) });
          if (!Number.isSafeInteger(issue.number) || issue.number < 1 || !Number.isSafeInteger(issue.id)
            || issue.user?.id !== user.id || !/^\d{4}-\d\d-\d\dT/.test(issue.created_at ?? '')
            || issue.html_url !== `https://github.com/${config.repository}/issues/${issue.number}`) throw error('GITHUB_INVALID_SAVE_ACK', 502);
          return respond({ status: 'GITHUB_SAVED_PENDING_PROJECTION', decision_id: `github-issue:${issue.number}`, issue_number: issue.number,
            id: issue.id, html_url: issue.html_url, created_at: issue.created_at, client_request_id: value.client_request_id,
            projection_pending: true }, 201);
        }
        throw error('NOT_FOUND', 404);
      } catch (cause) {
        // Never forward provider response bodies, exception details or secrets.
        return respond({ error: cause.status ? cause.message : 'GATEWAY_INTERNAL_ERROR' }, cause.status ?? 500,
          route === '/auth/callback' ? { 'Set-Cookie': cookie('', 0) } : {});
      }
    },
  };
}
export default createGateway();
