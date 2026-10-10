# GitHub App manifest bootstrap for the Owner feedback gateway

Deliverable: bootstrap.mjs (83 lines), bootstrap.test.mjs (14 PASS), integration instructions below. No existing gateway/worker files were changed. No production deploy, GitHub App creation, App installation, OAuth login or live feedback submission has been performed. Official documentation was retrieved2026-10-10; provider responses in tests are synthetic.

User journey: Pages GET API/health -> SETUP_REQUIRED and fixed setup_url -> user clicks 首次连接GitHub -> /setup/start autoPOSTs manifest to official GitHub -> user names/confirms Create GitHub App -> GitHub temporarycode callback -> server validates signed cookie/state and returned App owner -> stores only client_id/client_secret privately and redirects directly to the verified GitHub App installation URL. User selects ONLY iddunk/AstraStaff-product-progress and confirms Install; GitHub returns to fixed Pages using manifest setup_url. User then uses GitHub login. There is no manual App-settings navigation. GitHub authorization must be from the configured Owner. No secret copying, alternate cloud account or business database is required. GitHub App registration alone is not installation/repository readiness and health ready is not Issue submission acceptance.

Official evidence:

- https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest defines POST https://github.com/settings/apps/new with JSON manifest form field and randomstate; redirect_url gets temporarycode+state; conversion is POST /app-manifests/{code}/conversions. Complete within onehour. Supports name/url/redirect_url/callback_urls/setup_url/public/default_permissions/hook_attributes. setup_url is the fixed Pages return after installation. hook_attributes.url is documented REQUIRED even with active:false, so this module adds fixedAPI/setup/webhook (inactive, no receiver) instead of only {active:false}. request_oauth_on_install exists officially but is omitted; explicit installation+normal OAuth has clearer integration behavior.
- https://docs.github.com/en/rest/apps/apps?apiVersion=2022-11-28#create-a-github-app-from-a-manifest returns201 and App owner/client_id/client_secret/pem/webhook_secret. This module discards pem/webhook_secret and all unneeded metadata. Official REST OpenAPI https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json operation apps/create-from-manifest has no security requirement, and official manifest handshake uses the temporarycode without prior API credential. Some generic REST curl renderers include an Authorization placeholder; no PAT/token is needed by this manifest conversion. No Authorization is sent and tests assert that.
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app states GitHub Apps do not request OAuth scopes. App usertokens have only the intersection of user and App permissions/repository access. Default usertoken expiry8h; existing gateway's session max8h fits, revocation/expiry still enforced on each /user read. This module doesn't store refresh/private-key tokens or implement installation-token auth.

Adoption decision: ADOPT GitHub's official manifest/OAuth/Issues/Contents APIs; WRAP with standard Node fs/crypto and Fetch. This is configuration glue, not a new identity/auth/runtime database. No new package or image dependency. Existing pinned Node22+ and current gateway remain replaceable. Probot supports this commodity flow but adding its webhook/runtime/dependency surface is unnecessary for a2credential one-shot adapter. Exit: revoke/delete GitHub App and remove independent gateway after retaining GitHub ledger; no business runtime truth depends on bootstrap. Official GitHub API ToS applies; Node standard runtime is existing adopted infrastructure.

Node adapter integration (Root/adapter owner only):

```js
import {bootstrap} from './bootstrap.mjs';
// after request construction, before gateway.fetch; env is existing mutable const object
const response = await bootstrap(request, env, {
  credentialPath: env.GITHUB_OAUTH_CREDENTIAL_FILE ?? '/run/secrets/owner-github-oauth.json'
}) ?? await gateway.fetch(request, env);
```

Keep `const env={...process.env}` mutable. Existing SESSION_SECRET_FILE and OWNER_CONFIG_JSON_FILE are loaded normally. Configure BASE_PATH=/owner-review-api, OAUTH_CALLBACK_URL=https://chenqitengsheng.com/owner-review-api/auth/callback, fixed PAGES_URL and ownerLogins['iddunk']. Credential file defaults /run/secrets/owner-github-oauth.json backed by precreated private host directory /opt/product-owner-control/secrets. Parent must exist, have no symlink, and be writable by the Node service user. Mount the credential DIRECTORY writable, not a nonexistent single-file bind. Existingfile is read and schema/mode validated on eachrequest; absentfile enables setup. Newfile created exclusivewx with0600 andfsync; only after successful write is mutableenv configured. On restart bootstrap reloads twofields and sets GITHUB_APP_MODE='true'. Badfile is never treated as absent or overwritten. Windows local tests cannot prove POSIX0600; Linux deployment inspection is required.

Worker auth patch (adapter owner; not included/edited here): build URLSearchParams without scope when env.GITHUB_APP_MODE==='true'; retain public_repo only for legacy OAuth App mode. For example:

```js
const params={client_id:env.GITHUB_CLIENT_ID,redirect_uri:callback.href,state};
if(env.GITHUB_APP_MODE!=='true')params.scope='public_repo';
target.search=new URLSearchParams(params).toString();
```

Existing gateway's GitHub/Owner checks, Issue CAS/preflight and response verification remain unchanged. Root should add a worker regression asserting App-mode auth/start lacks scope and legacy mode retains it. Don't let frontend/user input toggle mode.

Manifest field set is static and contains only official fields: nameProductOwnerReview, URLfixedPages, redirectfixedSetupCallback, callbackfixedAuthCallback, setup_urlfixedPages, publicfalse, issueswrite/contentsread, inactivehookfixedURL. No input controls owner, URL, permissions or file path. Unknown start/callback queryfields failclosed. Wrongorigin, state/cookie mismatch, expired/tamperedstate, wrongreturnedOwner/organization, elevatedpermissions, malformedcredentialresponse, non201conversion and duplicate/concurrent storage failclosed with stableerrors. No secret or providerbody is logged or returned; successful callback redirects only to https://github.com/apps/<verified-slug>/installations/new. The returned slug must match lowercase /^[a-z0-9-]+$/ (max100), and returned html_url must exactly equal https://github.com/apps/<slug>; rejected targets never persist credentials. Fixed Pages is the installation setup_url. Public setup can create an App under the wrong GitHub account, but callback refuses persistence and gatewayconfiguration; that person can delete their own unused App on GitHub.

Verification:

```powershell
node --check D:/projects/project_01/.tmp/owner-control-github-bootstrap/bootstrap.mjs
node --test D:/projects/project_01/.tmp/owner-control-github-bootstrap/bootstrap.test.mjs
```

14 testsPASS: missingcredential health/CORS, exactmanifest, authfree conversion/owner/storage/env/verifiedofficialinstallredirect, restart, tamper/absentcookie/unknownquery, expiredstate, wrongowner, orgowner/extrapermission, malformed/non201/networkprovider and secretredaction, concurrentwx, wrongorigin/config/method/query, badexistingfile, unrelatedpath and malicious provider installation redirects. Tests retain explicitly synthetic credential fixtures in test-evidence under staging only; don't package those JSON files or raw docs/OpenAPI snapshots into gatewayimage/Git. Package only bootstrap.mjs, optional bootstrap.test.mjs and thisREADME.

Remaining production gates: reviewed rootNodeadapter and Appmodeworkerpatch; independently pinned gatewayimage; private writable secretmount+generated SESSION_SECRET; fixed Caddy route; Pageshealth/setup/login buttons; one realOwner GitHubAppcreation; exactrepo installation; normalOAuthlogin; actual authenticated Issuecreate+GitHuback+ledgerprojection; provider failure/takeover evidence. Bootstrap tests are CODE/CONTRACT only, not successful live GitHub registration.

Official automatic installation handoff (current final behavior): https://docs.github.com/en/apps/sharing-github-apps/sharing-your-github-app documents installation URL https://github.com/apps/APP-NAME/installations/new. The manifest documentation defines setup_url as the post-install redirect. Final flow is therefore Create GitHub App -> official installation page -> select exact repository + Install -> GitHub returns fixed Pages -> normal GitHub login/authorization. Registration does not guarantee installation or repository grant; live installation remains NOT_VALIDATED. Only the response-verified strict slug is used for the installation URL; there is no provider/user arbitrary URL redirect or installation-token credential storage. No App slug/private key/webhook secret is persisted.
