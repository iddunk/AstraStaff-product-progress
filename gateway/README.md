# Direct Owner feedback API

This is a standalone thin HTTP gateway for the existing GitHub Pages review page. It uses official GitHub OAuth code flow and the authenticated user's GitHub API token to create public feedback Issues. It has no business database, D1, KV, durable object, local session file or application runtime integration. `worker.mjs` is portable standard Fetch/WebCrypto code; `server.mjs` runs it on Node 22 behind the existing HTTPS reverse proxy. Cloudflare hosting is optional and is not required.

Deploy the Node gateway independently from the business application's image and compose services. The current candidate base URL is `https://chenqitengsheng.com/owner-review-api`, routed by the existing HTTPS proxy to the gateway's private port 8080. Set `BASE_PATH=/owner-review-api`; keep that prefix when proxying, since the handler strips it internally. No new DNS is required. The gateway never trusts incoming Host or Forwarded headers for OAuth redirects.

Required configuration:

```text
BASE_PATH=/owner-review-api
OAUTH_CALLBACK_URL=https://chenqitengsheng.com/owner-review-api/auth/callback
PAGES_URL=https://iddunk.github.io/AstraStaff-product-progress/product-experience-review.html
LEDGER_BRANCH=gh-pages
SESSION_TTL_SECONDS=28800
OWNER_CONFIG_JSON=<the actual source/owner-control.config.json JSON, including 13 modules>
GITHUB_CLIENT_ID=<OAuth App client ID>
GITHUB_CLIENT_SECRET=<OAuth App client secret>
SESSION_SECRET=<at least 32 cryptographically random characters>
```

Node supports `_FILE` alternatives for `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`, and `OWNER_CONFIG_JSON`, so the existing mounted SecretReference mechanism can provide values without embedding secrets in images or source. No values are logged. Docker deployment must supply an independently verified digest in `NODE_IMAGE`; the example's pinned version tag alone is not an immutable image acceptance.

The deployed configuration uses the official GitHub App manifest setup in BOOTSTRAP.md with repository-scoped Issues write and Contents read. GITHUB_APP_MODE=true omits OAuth scopes. The following OAuth App mode is a compatibility alternative, not the current setup: an administrator creates a GitHub OAuth App with the exact callback URL. This integration requests `public_repo`, because an OAuth App uses the GitHub user's permission to create public repository Issues. The gateway itself is hard-scoped to the one configured repository and approved Owner login, but GitHub's OAuth permission screen shows the broader public-repository scope. A fine-grained GitHub App can replace that provider authorization later without changing the feedback contract; this implementation does not claim a GitHub App flow was validated.

## Page integration

Use top-level navigation to `<API_BASE>/auth/start` on the first login. The state is signed, expires in 10 minutes, and is also checked against a secure HttpOnly SameSite=Lax cookie. GitHub returns the authorization code to the fixed callback. After exchanging it and verifying `GET /user`, the gateway redirects only to configured `PAGES_URL#owner_session=<opaque AES-GCM token>&expires_in=28800`.

The page immediately reads the fragment, stores `owner_session` in `sessionStorage`, and removes the fragment with `history.replaceState`. Never put it in query parameters, links, logs, `localStorage`, or DOM. The actual GitHub access token is encrypted inside the opaque session; it is never sent to the page in plaintext. Session defaults to 8 hours and can be configured from 5 minutes to 24 hours. Identity is revalidated from GitHub for every authenticated API request. Logout clears `sessionStorage`; this stateless v1 does not centrally revoke individual encrypted sessions before their expiry. Revoking the OAuth authorization at GitHub immediately causes provider identity checks to fail.

For API calls, send `Authorization: Bearer <owner_session>` and JSON content type. Browser Origin must match the configured Pages origin. Preflight allows only that origin, `Authorization`, `Content-Type`, and GET/POST. Cookies are used only for the top-level OAuth state, not API authentication.

| Endpoint | Behavior |
| --- | --- |
| `GET /health` | Public `{status:"ready",service:"owner-feedback-gateway"}` after config validation; no GitHub secrets returned |
| `GET /auth/start` | Redirects to GitHub login with signed state |
| `GET /auth/callback` | Verifies state/cookie, exchanges code, checks approved GitHub login, returns fixed page fragment |
| `GET /session` | `{authenticated:true,login:"iddunk",id:<GitHub user ID>}` |
| `POST /feedback` | Validates exact ledger feedback JSON, fresh revisions and current expected decision, creates authenticated public Issue |
| `GET /decisions` | Fetches current projection through GitHub Contents API to avoid raw CDN delay |

Paths in that table are appended to the configured API base. `POST /feedback` accepts the existing feedback payload, including optional `validation_only`. It returns HTTP 201 only after a verified provider response:

```json
{
  "status": "GITHUB_SAVED_PENDING_PROJECTION",
  "decision_id": "github-issue:42",
  "issue_number": 42,
  "id": 12345678,
  "html_url": "https://github.com/iddunk/AstraStaff-product-progress/issues/42",
  "created_at": "2026-10-10T00:00:00Z",
  "client_request_id": "11111111-1111-4111-8111-111111111111",
  "projection_pending": true
}
```

The page can immediately say GitHub saved the feedback, then poll `/decisions` or the public raw projection until that UUID is present in history. The Actions processor determines whether it is accepted, duplicated, rejected, or conflicted. Keep the same UUID when recovering an uncertain POST; do not invent a new one. The gateway does not search GitHub's eventually consistent search index or claim atomic issue creation idempotency. A retry can create a second public issue before projection catches up; the ledger deduplicates the UUID and cannot apply its opinion twice. If the first submission is already current, CAS preflight returns 409 for the stale expectation; re-read its UUID before offering another submission.

Preflight reads `ledger/decisions.json` from GitHub Contents before creating an Issue and fails with 409 `LATEST_DECISION_CONFLICT` if the expected decision is stale, 409 `STALE_REVIEW_REVISION` for an obsolete page/module proposal, or 409 `GATEWAY_REVIEW_CONFIG_STALE` if the deployed gateway config lags the ledger. The projection must be initialized and committed before enabling the page. Actions retains its own CAS check for races between that preflight and eventual processing. Errors return `{error:"STABLE_CODE"}` without provider details, tokens or secret material. A saved Issue is not yet an applied Owner decision or production acceptance.

## Verification and limits

Run `node --test gateway/worker.test.mjs scripts/owner-ledger.test.mjs`, `node --check gateway/worker.mjs`, and `node --check gateway/server.mjs`. The mocked tests validate state rejection, owner identity, CORS, tamper rejection, direct provider acknowledgement, exact inert issue JSON, and provider failure behavior. No live OAuth App, ECS deployment, Caddy route or browser login is claimed by these local tests.

Adoption decision: use GitHub's official OAuth and Issues HTTP APIs plus Node standard HTTP/WebCrypto. This flow is small enough to avoid an additional OAuth framework or session storage service. The replaceable boundary is `createGateway(fetcher)`. The remaining external dependencies are the OAuth App registration/secret, independently deployed gateway/proxy, GitHub availability and the existing Actions ledger processor.
