# Owner feedback deployment

The only product review surface is this GitHub Pages repository. The browser saves feedback through the standalone gateway; GitHub Issues and append-only ledger events own the records. Local copies are source checkouts or disposable QA evidence, not another product state.

Current endpoint: https://chenqitengsheng.com/owner-review-api
Public health was read back HTTP 200 / SETUP_REQUIRED on 2026-10-10 Asia/Shanghai. It means first GitHub App connection is still required, not that a real Owner submission was accepted.

One-time connection: open product-experience-review.html, choose 首次连接 GitHub, confirm the GitHub App, install it only on iddunk/AstraStaff-product-progress, return to Pages and sign in. Subsequent feedback is saved in the page; no Issue-form navigation or credential copying is required.

Code is gateway/server.mjs + gateway/worker.mjs + gateway/bootstrap.mjs. Runtime Node v22.16.0 was verified on the existing immutable cached image; no business application is executed by this standalone container. A fresh official Node 22.22.2 pull timed out, so it is not claimed as deployed. The independent container has a private network, read-only code filesystem, dropped capabilities, bounded resources and localhost port 4188. Existing HTTPS proxy forwards only /owner-review-api/* to it. Caddy v2.10.2 did not support SIGUSR1 reload, so the validated route was activated by one proxy service restart; business containers and database were not restarted.

The external private directory is /opt/product-owner-control/secrets. It contains a random session signing/encryption secret and, only after the Owner connects GitHub, client_id/client_secret. It never belongs in this public repository. APP credentials are created through the official GitHub manifest conversion and saved mode 0600. No business database or durable session database is used.

Reuse in another project: configure source/owner-control.config.json repository, Owner GitHub logins, semantic module IDs and page revisions; deploy the same independent gateway with that config and fixed Pages/callback URLs; run the first GitHub connection flow. Keep one ledger per repository. The app requires Issues write and Contents read on the selected repository only.

Validation performed: 42 Node contract tests and real Chromium desktop 1440/mobile 390 tests with mocked API responses. Live API health and original business version endpoint are reachable. GitHub App creation, selected-repository installation, real Owner OAuth, in-page provider-backed save and Action projection are separate acceptance gates and must be recorded when exercised.

Before any product work or release, read authoritative Control + GitHub ledger/current feedback + shared current State + current Goal. ACCEPT permits the proposal, KEEP_CURRENT forbids the suggested change, ADJUST_PROPOSAL stops propagation and requires a new proposal, UNDECIDED remains unconfirmed. A Control change requires CONTROL_CHANGE_PROPOSAL and explicit authority. Active agents poll at 60-second boundaries; idle chat wakeup is not provided by a static page.
Route continuity fix, 2026-10-10: the existing business deployment regenerated Caddy at 17:42 and removed the gateway route. A root-owned, fixed-path ExecStartPre hook now preserves only the reviewed /owner-review-api loopback route when the proxy starts. Its systemd drop-in survives main-unit rewrites. Public health returned 200 after installation. The actual host Python 3.6.8 and Caddy 2.10.2 verified restoration from a route-less temporary generated config and an idempotent second run; the live config bytes stayed unchanged during that proof. Source and seven focused tests are in gateway/deploy/. No generic background monitor or workflow engine was added.
