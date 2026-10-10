import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const staging = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.OWNER_REVIEW_ROOT || staging);
const config = JSON.parse(fs.readFileSync(path.join(root, 'owner-control.config.json'), 'utf8'));
config.gatewayUrl ||= 'https://feedback.example.test/owner-review-api';
let html = fs.readFileSync(path.join(root, '..', 'product-experience-review.html'), 'utf8');
const client = fs.readFileSync(process.env.OWNER_CLIENT_PATH || path.join(staging, 'owner-control.js'), 'utf8');
html = html.replace(/(<script[^>]*id="owner-control-client"[^>]*>)[\s\S]*?(<\/script>)/, (_, a, b) => a + '\n' + client + '\n' + b);
html = html.replace(/(<script[^>]*id="owner-control-config"[^>]*>)[\s\S]*?(<\/script>)/, (_, a, b) => a + JSON.stringify(config).replace(/</g, '\\u003c') + b);
assert(html.includes('window.history.replaceState'), 'Staged direct API client must be included');
const first = config.modules[0];
const storageKey = 'owner-github-drafts:' + config.repository + ':' + config.pageId;
const sessionKey = 'owner-github-session:' + config.repository;
const token = 'mock-opaque-session-never-localStorage';
const malicious = '<img src=x onerror="window.ownerXss=true">';
const initial = { schema_version: 1, repository: config.repository, page_revision: config.pageRevision, current: [], history: [] };
const entry = { decision_id: 'github-issue:11', module_id: first.moduleId, page_revision: config.pageRevision, proposal_revision: first.proposalRevision, decision: 'KEEP_CURRENT', comment: malicious, client_request_id: 'retained', created_at: '2026-10-10T08:00:00Z', issue_number: 11, status: 'OPEN', outcome: 'ACCEPTED', author: 'iddunk' };
initial.current = [entry]; initial.history = [entry];
const output = process.env.OWNER_QA_OUTPUT || path.join(staging, '.qa-direct');
fs.mkdirSync(output, { recursive: true });
const server = http.createServer((req, res) => {
  const relative = new URL(req.url, 'http://local').pathname;
  if (relative.endsWith('/product-experience-review.html')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); return; }
  const file = path.resolve(root, '..', '.' + relative);
  if (!file.startsWith(path.resolve(root, '..') + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': file.endsWith('.png') ? 'image/png' : 'application/octet-stream' }); res.end(fs.readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port + '/product-experience-review.html';
const executablePath = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
const rows = [];
try {
  for (const viewport of [{ width: 1440, height: 1100 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    await context.route('**/*', route => route.request().url().startsWith(new URL(url).origin) ? route.continue() : route.abort());
    await context.addInitScript(({ initial, config, token }) => {
      const q = window.__ownerQA = { ledger: JSON.parse(sessionStorage.getItem('__qa_ledger') || JSON.stringify(initial)), calls: [], opened: [], fail: false, defer: false, conflict: false, nextIssue: 13, pending: null };
      q.persist = () => sessionStorage.setItem('__qa_ledger', JSON.stringify(q.ledger));
      q.project = (payload, number) => { const record = { ...payload, decision_id: 'github-issue:' + number, issue_number: number, created_at: '2026-10-10T08:05:00Z', author: 'iddunk', outcome: 'ACCEPTED', status: 'OPEN' }; q.ledger.current = [record]; q.ledger.history.push(record); q.persist(); window.dispatchEvent(new Event('focus')); };
      window.open = target => { q.opened.push(target); return null; };
      window.fetch = async (input, init = {}) => {
        const target = String(input); q.calls.push({ target, method: init.method || 'GET', body: init.body, authorization: init.headers?.Authorization });
        if (q.fail) throw new Error('Offline');
        if (target === config.gatewayUrl + '/health') return new Response(JSON.stringify({ status: 'READY' }), { status: 200 });
        if (target === config.gatewayUrl + '/session') return new Response(JSON.stringify({ authenticated: true, login: 'iddunk', id: 42 }), { status: 200 });
        if (target.startsWith(config.ledgerUrl) || target === config.gatewayUrl + '/decisions') return new Response(JSON.stringify(q.ledger), { status: 200 });
        if (target === config.gatewayUrl + '/feedback' && init.method === 'POST') {
          if (q.conflict) return new Response(JSON.stringify({ error: 'LATEST_DECISION_CONFLICT' }), { status: 409 });
          const payload = JSON.parse(init.body), number = q.nextIssue++;
          const receipt = { status: 'GITHUB_SAVED_PENDING_PROJECTION', decision_id: 'github-issue:' + number, issue_number: number, id: 9000 + number, html_url: 'https://github.com/' + config.repository + '/issues/' + number, created_at: '2026-10-10T08:05:00Z', client_request_id: payload.client_request_id, projection_pending: true };
          if (q.defer) return new Promise(resolve => { q.pending = () => resolve(new Response(JSON.stringify(receipt), { status: 201 })); });
          return new Response(JSON.stringify(receipt), { status: 201 });
        }
        throw new Error('Unexpected endpoint');
      };
    }, { initial, config, token });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url + '#owner_session=' + token + '&expires_in=28800');
    const area = page.locator('[data-module-id="' + first.moduleId + '"]');
    await page.locator('.owner-access-bar').filter({ hasText: 'GitHub · iddunk' }).waitFor();
    await area.locator('.owner-current').filter({ hasText: '保持现状' }).waitFor();
    assert.equal(new URL(page.url()).hash, '');
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), sessionKey), token);
    assert.equal(await page.evaluate(t => Object.values(localStorage).some(value => value.includes(t)), token), false);
    assert.equal(await page.locator('.owner-control').count(), config.modules.length);
    assert.equal(await page.locator('.owner-control img').count(), 0);
    assert.equal(await page.evaluate(() => !!window.ownerXss), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await area.locator('.owner-editor > summary').click();
    await area.locator('[data-decision="ADJUST_PROPOSAL"]').click();
    await area.locator('textarea').fill('已发送的第一版');
    await page.evaluate(() => window.__ownerQA.defer = true);
    await area.locator('.owner-submit').click();
    await page.waitForFunction(() => !!window.__ownerQA.pending);
    const firstPayload = await page.evaluate(() => JSON.parse(window.__ownerQA.calls.find(call => call.method === 'POST').body));
    await area.locator('textarea').fill('提交过程中继续编辑的新草稿');
    await page.evaluate(() => { window.__ownerQA.pending(); window.__ownerQA.defer = false; });
    await area.locator('.owner-status').filter({ hasText: '草稿 · 尚未提交' }).waitFor();
    assert.equal(await area.locator('textarea').inputValue(), '提交过程中继续编辑的新草稿');
    assert.equal(await area.locator('.owner-submit').isDisabled(), false);
    assert.equal(await area.locator('.owner-current').innerText(), '当前意见：保持现状');
    await page.evaluate(payload => window.__ownerQA.project(payload, 13), firstPayload);
    await area.locator('.owner-status').filter({ hasText: '需要核对' }).waitFor();
    assert.equal(await area.locator('textarea').inputValue(), '提交过程中继续编辑的新草稿');
    assert.equal(await area.locator('.owner-submit').isDisabled(), true);
    await area.locator('.owner-reconcile').click();
    await area.locator('[data-decision="KEEP_CURRENT"]').click();
    await area.locator('.owner-submit').click();
    await area.locator('.owner-status').filter({ hasText: 'GitHub 已保存' }).waitFor();
    assert.match(await area.locator('.owner-current').innerText(), /方案需调整/);
    const secondPayload = await page.evaluate(() => JSON.parse(window.__ownerQA.calls.filter(call => call.method === 'POST').at(-1).body));
    assert.equal(secondPayload.expected_latest_decision_id, 'github-issue:13');
    assert.notEqual(secondPayload.client_request_id, firstPayload.client_request_id);
    assert.equal(page.url(), url);
    assert.deepEqual(await page.evaluate(() => window.__ownerQA.opened), []);
    await page.reload();
    await page.locator('.owner-access-bar').filter({ hasText: 'GitHub · iddunk' }).waitFor();
    await area.locator('.owner-editor > summary').click();
    assert.equal(await area.locator('textarea').inputValue(), '提交过程中继续编辑的新草稿');
    await page.evaluate(payload => window.__ownerQA.project(payload, 14), secondPayload);
    await area.locator('.owner-status').filter({ hasText: '保持现状' }).waitFor();
    assert.equal(await page.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key) || '{}')[id] ?? null, { key: storageKey, id: first.moduleId }), null);
    await area.locator('[data-decision="UNDECIDED"]').click();
    await area.locator('textarea').fill('测'.repeat(2000));
    assert.equal(await area.locator('textarea').inputValue(), '测'.repeat(2000));
    await page.evaluate(() => window.__ownerQA.conflict = true);
    await area.locator('.owner-submit').click();
    await area.locator('.owner-status').filter({ hasText: '需要核对' }).waitFor();
    assert.equal(await area.locator('textarea').inputValue(), '测'.repeat(2000));
    assert.equal(await area.locator('.owner-submit').isDisabled(), true);
    await area.locator('.owner-reconcile').click();
    await area.locator('.owner-discard').click();
    await area.locator('[data-decision="ACCEPT"]').click();
    await area.locator('textarea').fill('投影先到，响应随后到达');
    await page.evaluate(() => { window.__ownerQA.conflict = false; window.__ownerQA.defer = true; window.__ownerQA.nextIssue = 15; });
    await area.locator('.owner-submit').click();
    await page.waitForFunction(() => !!window.__ownerQA.pending);
    const earlyPayload = await page.evaluate(() => JSON.parse(window.__ownerQA.calls.filter(call => call.method === 'POST').at(-1).body));
    await page.evaluate(payload => window.__ownerQA.project(payload, 15), earlyPayload);
    await page.waitForFunction(({ key, id }) => !JSON.parse(localStorage.getItem(key) || '{}')[id], { key: storageKey, id: first.moduleId });
    await page.evaluate(() => window.__ownerQA.pending());
    await area.locator('.owner-status').filter({ hasText: '接受建议' }).waitFor();
    assert.equal(await area.locator('.owner-status').innerText(), '接受建议');
    assert.equal(await area.locator('.owner-latest').getByText('已保存至 GitHub #15', { exact: true }).count(), 0);
    await page.screenshot({ path: path.join(output, 'review-' + viewport.width + '.png'), fullPage: true });
    await area.screenshot({ path: path.join(output, 'feedback-' + viewport.width + '.png') });
    assert(await page.locator('.owner-decisions button').evaluateAll(nodes => nodes.filter(node => node.getBoundingClientRect().height > 0).every(node => node.getBoundingClientRect().height >= 44)));
    await page.evaluate(() => { window.__ownerQA.fail = true; window.dispatchEvent(new Event('focus')); });
    await area.locator('.owner-status').filter({ hasText: '暂未取得' }).waitFor();
    await area.locator('[data-decision="KEEP_CURRENT"]').click();
    assert.equal(await area.locator('.owner-submit').isDisabled(), true);
    assert.equal(await page.evaluate(t => Object.values(localStorage).some(value => value.includes(t)), token), false);
    assert.deepEqual(errors, []);
    rows.push({ viewport, modules: config.modules.length, status: 'PASS', checks: ['OAuth fragment cleared', 'sessionStorage only', 'direct POST without navigation', 'in-flight edit retained', 'provider receipt distinct from projection', 'early projection race', 'cross-device CAS', '409 draft retained', 'reload', '2000 CJK chars', 'XSS inert', '44px touch', 'no overflow', 'offline retained'] });
    await context.close();
  }
  for (const mode of ['SETUP_REQUIRED', 'UNAVAILABLE']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const navigations = [];
    await context.route('**/*', async route => {
      const target = route.request().url();
      if (target.startsWith(new URL(url).origin)) return route.continue();
      navigations.push(target); return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Setup destination</p>' });
    });
    await context.addInitScript(({ config, initial, mode }) => {
      window.fetch = async (input,init={}) => {
        if (String(input) === config.gatewayUrl + '/health') {
          if(new Headers(init.headers).has('content-type') || new Headers(init.headers).has('authorization')) throw new Error('Public health must remain a simple request');
          if (mode === 'UNAVAILABLE') throw new Error('Gateway offline');
          return new Response(JSON.stringify({ status: 'SETUP_REQUIRED', setup_url: 'https://attacker.example/not-trusted' }), { status: 200 });
        }
        if (String(input).startsWith(config.ledgerUrl)) return new Response(JSON.stringify(initial), { status: 200 });
        throw new Error('Unexpected endpoint');
      };
    }, { config, initial, mode });
    const page = await context.newPage(); await page.goto(url);
    await page.locator('.owner-current').filter({ hasText: '保持现状' }).waitFor();
    if (mode === 'SETUP_REQUIRED') {
      await page.locator('.owner-login').filter({ hasText: '首次连接 GitHub' }).click();
      await page.waitForURL(config.gatewayUrl + '/setup/start');
      assert.deepEqual(navigations, [config.gatewayUrl + '/setup/start']);
    } else {
      await page.locator('.owner-access-bar').filter({ hasText: '登录服务暂不可用' }).waitFor();
      assert.equal(await page.locator('.owner-login').isDisabled(), false);
      assert.equal(await page.locator('.owner-login').innerText(), '重新检查登录服务');
      await page.locator('.owner-login').click();
      assert.equal(await page.locator('.owner-current').innerText(), '当前意见：保持现状');
    }
    rows.push({ scenario: mode, status: 'PASS', checks: [mode === 'SETUP_REQUIRED' ? 'fixed setup URL ignores arbitrary provider URL' : 'health failure preserves public ledger reading'] });
    await context.close();
  }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(rows, null, 2) + '\n');
  console.log(JSON.stringify(rows, null, 2));
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
