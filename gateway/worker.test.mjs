import test from 'node:test';
import assert from 'node:assert/strict';
import { createGateway } from './worker.mjs';
const config = { repository: 'iddunk/AstraStaff-product-progress', ownerLogins: ['iddunk'], pageId: 'product-experience-review', pageRevision: 80, modules: [{ moduleId: 'employee-home', proposalRevision: 1 }] };
const env = { OWNER_CONFIG_JSON: JSON.stringify(config), PAGES_URL: 'https://iddunk.github.io/AstraStaff-product-progress/product-experience-review.html', OAUTH_CALLBACK_URL: 'https://feedback.example.com/auth/callback', SESSION_SECRET: 'test-only-32-byte-session-secret-not-live', GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-secret' };
const owner = { id: 42, login: 'iddunk' };
const feedback = { schema_version: 1, page: config.pageId, module_id: 'employee-home', page_revision: 80, proposal_revision: 1, decision: 'ACCEPT', comment: 'Owner suggestion', expected_latest_decision_id: null, client_request_id: '11111111-1111-4111-8111-111111111111' };
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
const req = (route, options = {}) => new Request(`https://feedback.example.com${route}`, options);
const headers = (token, origin = 'https://iddunk.github.io') => ({ Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
function mock(user = owner, provider = undefined, calls = []) {
  return async (url, options) => {
    calls.push({ url, options });
    if (url === 'https://github.com/login/oauth/access_token') return response({ access_token: 'test-provider-token', token_type: 'bearer' });
    if (url === 'https://api.github.com/user') return response(user);
    if (url.includes('/contents/ledger/decisions.json')) return response({ encoding: 'base64', content: btoa(JSON.stringify({ schema_version: 1, repository: config.repository, page_revision: 80, current: [] })) });
    if (url.endsWith('/issues')) return provider ?? response({ number: 7, id: 77, user: owner, html_url: `https://github.com/${config.repository}/issues/7`, created_at: '2026-10-10T00:00:00Z' }, 201);
    throw new Error('Unexpected route');
  };
}
async function login(worker) {
  const start = await worker.fetch(req('/auth/start'), env);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const result = await worker.fetch(req(`/auth/callback?state=${encodeURIComponent(state)}&code=test-code`, { headers: { Cookie: start.headers.get('set-cookie').split(';')[0] } }), env);
  const location = result.headers.get('location');
  return { start, result, token: location ? new URLSearchParams(new URL(location).hash.slice(1)).get('owner_session') : null };
}
test('OAuth fixed redirects, secure state cookie, opaque fragment session', async () => {
  const calls = []; const { start, result, token } = await login(createGateway(mock(owner, undefined, calls)));
  assert.equal(start.status, 302); assert.equal(result.status, 302);
  assert.equal(new URL(start.headers.get('location')).origin, 'https://github.com');
  assert.match(start.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
  assert.equal(new URL(result.headers.get('location')).origin, 'https://iddunk.github.io');
  assert.ok(token && !token.includes('test-provider-token'));
  assert.equal(new URL(result.headers.get('location')).search, '');
  assert.equal(JSON.parse(calls[0].options.body).client_secret, 'test-secret');
});
test('wrong OAuth state/missing cookie rejects before code exchange', async () => {
  const calls = []; const worker = createGateway(mock(owner, undefined, calls));
  const start = await worker.fetch(req('/auth/start'), env);
  for (const options of [{}, { headers: { Cookie: start.headers.get('set-cookie').split(';')[0] } }]) {
    const result = await worker.fetch(req('/auth/callback?state=forged&code=code', options), env);
    assert.equal(result.status, 403); assert.equal((await result.json()).error, 'OAUTH_STATE_INVALID');
  }
  assert.equal(calls.length, 0);
});
test('non-owner GitHub identity cannot finish OAuth', async () => {
  const { result } = await login(createGateway(mock({ id: 99, login: 'stranger' })));
  assert.equal(result.status, 403); assert.equal((await result.json()).error, 'OWNER_LOGIN_REQUIRED');
});
test('session revalidates actual GitHub identity on every request', async () => {
  const calls = []; const worker = createGateway(mock(owner, undefined, calls)); const { token } = await login(worker);
  const result = await worker.fetch(req('/session', { headers: headers(token) }), env);
  assert.deepEqual(await result.json(), { authenticated: true, login: 'iddunk', id: 42 });
  assert.equal(calls.filter((call) => call.url.endsWith('/user')).length, 2);
});
test('direct feedback creates exact inert body and verified provider acknowledgement', async () => {
  const calls = []; const worker = createGateway(mock(owner, undefined, calls)); const { token } = await login(worker);
  const result = await worker.fetch(req('/feedback', { method: 'POST', headers: headers(token), body: JSON.stringify(feedback) }), env);
  assert.equal(result.status, 201);
  assert.deepEqual(await result.json(), { status: 'GITHUB_SAVED_PENDING_PROJECTION', decision_id: 'github-issue:7', issue_number: 7, id: 77, html_url: `https://github.com/${config.repository}/issues/7`, created_at: '2026-10-10T00:00:00Z', client_request_id: feedback.client_request_id, projection_pending: true });
  const sent = JSON.parse(calls.at(-1).options.body);
  assert.equal(sent.title, 'Owner feedback: employee-home');
  assert.equal(sent.body, `<!-- owner-feedback:v1 -->\n\`\`\`json\n${JSON.stringify(feedback, null, 2)}\n\`\`\`\n`);
  assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer test-provider-token');
});
test('bad body/identity fields, stale revision and wrong Origin cannot create issues', async () => {
  const calls = []; const worker = createGateway(mock(owner, undefined, calls)); const { token } = await login(worker);
  for (const [value, status] of [[{ ...feedback, author: 'iddunk' }, 400], [{ ...feedback, comment: 'a'.repeat(2001) }, 400], [{ ...feedback, page_revision: 79 }, 409], [{ ...feedback, module_id: 'other' }, 400]]) {
    const result = await worker.fetch(req('/feedback', { method: 'POST', headers: headers(token), body: JSON.stringify(value) }), env);
    assert.equal(result.status, status);
  }
  assert.equal((await worker.fetch(req('/feedback', { method: 'POST', headers: headers(token, 'https://attacker.example'), body: JSON.stringify(feedback) }), env)).status, 403);
  assert.ok(!calls.some((call) => call.url.endsWith('/issues')));
});
test('provider rejection/malformed ack never claims saved or exposes provider body', async () => {
  for (const [provider, code] of [[response({ message: 'private provider detail' }, 403), 'GITHUB_REQUEST_FAILED'], [response({ number: 7 }, 201), 'GITHUB_INVALID_SAVE_ACK']]) {
    const worker = createGateway(mock(owner, provider)); const { token } = await login(worker);
    const result = await worker.fetch(req('/feedback', { method: 'POST', headers: headers(token), body: JSON.stringify(feedback) }), env);
    assert.equal(result.status, 502); assert.deepEqual(await result.json(), { error: code });
  }
});
test('session tampering fails; CORS allows only fixed Pages origin', async () => {
  const worker = createGateway(mock()); const { token } = await login(worker);
  assert.equal((await worker.fetch(req('/session', { headers: headers(`${token}tampered`) }), env)).status, 401);
  const result = await worker.fetch(req('/feedback', { method: 'OPTIONS', headers: { Origin: 'https://iddunk.github.io' } }), env);
  assert.equal(result.headers.get('access-control-allow-origin'), 'https://iddunk.github.io');
  assert.equal((await worker.fetch(req('/feedback', { method: 'OPTIONS', headers: { Origin: 'https://attacker.example' } }), env)).status, 403);
});

test('existing-domain API prefix supports callback/session and eight hour default', async () => {
  const worker = createGateway(mock());
  const mounted = { ...env, BASE_PATH: '/owner-review-api', OAUTH_CALLBACK_URL: 'https://feedback.example.com/owner-review-api/auth/callback' };
  const start = await worker.fetch(req('/owner-review-api/auth/start'), mounted);
  const target = new URL(start.headers.get('location'));
  assert.equal(target.searchParams.get('redirect_uri'), mounted.OAUTH_CALLBACK_URL);
  const callback = await worker.fetch(req(`/owner-review-api/auth/callback?state=${encodeURIComponent(target.searchParams.get('state'))}&code=code`, { headers: { Cookie: start.headers.get('set-cookie').split(';')[0] } }), mounted);
  assert.equal(callback.status, 302);
  const fragment = new URLSearchParams(new URL(callback.headers.get('location')).hash.slice(1));
  assert.equal(fragment.get('expires_in'), '28800');
  assert.equal((await worker.fetch(req('/owner-review-api/session', { headers: headers(fragment.get('owner_session')) }), mounted)).status, 200);
  assert.equal((await worker.fetch(req('/owner-review-api/health'), mounted)).status, 200);
  assert.equal((await worker.fetch(req('/session', { headers: headers(fragment.get('owner_session')) }), mounted)).status, 404);
});
test('server CAS preflight rejects stale expected ID before issue creation', async () => {
  const calls = [];
  const base = mock(owner, undefined, calls);
  const worker = createGateway(async (url, options) => {
    if (url.includes('/contents/ledger/decisions.json')) return response({ encoding: 'base64', content: btoa(JSON.stringify({ schema_version: 1, repository: config.repository, page_revision: 80, current: [{ module_id: 'employee-home', decision_id: 'github-issue:1' }] })) });
    return base(url, options);
  });
  const { token } = await login(worker);
  const result = await worker.fetch(req('/feedback', { method: 'POST', headers: headers(token), body: JSON.stringify(feedback) }), env);
  assert.equal(result.status, 409);
  assert.deepEqual(await result.json(), { error: 'LATEST_DECISION_CONFLICT' });
  assert.ok(!calls.some((call) => call.url.endsWith('/issues')));
});