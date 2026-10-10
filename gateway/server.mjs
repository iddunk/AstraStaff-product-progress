import http from 'node:http';
import { readFile } from 'node:fs/promises';
import gateway from './worker.mjs';
import {bootstrap} from './bootstrap.mjs';
const env = { ...process.env };
for (const key of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'SESSION_SECRET', 'OWNER_CONFIG_JSON']) {
  if (env[`${key}_FILE`]) env[key] = (await readFile(env[`${key}_FILE`], 'utf8')).trim();
}
const callback = new URL(env.OAUTH_CALLBACK_URL);
if (callback.protocol !== 'https:' || callback.pathname !== `${env.BASE_PATH ?? ''}/auth/callback`) throw new Error('INVALID_CALLBACK_URL');
const port = Number(env.PORT ?? 8080);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT');
http.createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, callback.origin);
    if (url.origin !== callback.origin) throw new Error('INVALID_REQUEST_TARGET');
    const chunks = []; let size = 0;
    for await (const chunk of incoming) {
      size += chunk.length;
      if (size > 16000) {
        outgoing.writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        outgoing.end('{"error":"PAYLOAD_TOO_LARGE"}'); return;
      }
      chunks.push(chunk);
    }
    const request = new Request(url, { method: incoming.method, headers: incoming.headers,
      ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Buffer.concat(chunks) } : {}) });
    const response = await bootstrap(request, env, {credentialPath: env.GITHUB_OAUTH_CREDENTIAL_FILE || '/run/secrets/owner-github-oauth.json'}) ?? await gateway.fetch(request, env);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    outgoing.end('{"error":"GATEWAY_INTERNAL_ERROR"}');
  }
}).listen(port, '0.0.0.0', () => console.log(`Owner feedback gateway listening on ${port}`));
