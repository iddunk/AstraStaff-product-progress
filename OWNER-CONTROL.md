# GitHub Owner Decision Ledger

> Delivery status publication cadence and Owner visibility are governed by [PROGRESS-PUBLISHING.md](./PROGRESS-PUBLISHING.md).

This is the feedback sidecar for the existing product experience review page. GitHub Issues owns authenticated public submissions, immutable Git files own the decision event archive, and `ledger/decisions.json` projects that archive for the existing page and active agents. No business database or additional product board is added. The standalone GitHub authorization gateway is deployed independently on the existing server; all feedback and decision history stay in this repository.

The preferred submission UX is now the direct API in `gateway/README.md`: the Owner signs in once, then the page posts feedback directly. The Issue JSON below is the underlying provider contract; opening a GitHub issue form is an optional manual fallback, not the main page flow.

## Integration and bootstrap

Copy `scripts/owner-ledger.mjs`, `scripts/publish-owner-ledger.mjs`, `scripts/owner-ledger.test.mjs`, and `.github/workflows/owner-decision-ledger.yml` into the existing Pages repository. Keep its page generator/client. Build its real `source/owner-control.config.json` from its 13 semantic modules; the example has only one illustrative module and must not replace the real module configuration.

The repository's default branch is currently `gh-pages`. An administrator enables Issues and Actions, allows this workflow's `GITHUB_TOKEN` to write contents, and initially pushes the files as a normal authenticated Git user. The initial ordinary push also publishes the HTML through the repository's current Pages mechanism. Example commands, run from the existing Pages checkout:

```powershell
gh repo edit iddunk/AstraStaff-product-progress --enable-issues
node --test scripts/owner-ledger.test.mjs
node scripts/owner-ledger.mjs --rebuild
git add -- scripts .github/workflows/owner-decision-ledger.yml source/owner-control.config.json ledger/decisions.json
git commit -m 'Add GitHub owner feedback ledger'
git push origin gh-pages
```

These commands are bootstrap instructions, not evidence they were executed. Branch protection must permit the configured Actions token to append ledger commits. The workflow must exist on the default branch for issue triggers. A manual workflow dispatch rebuilds from archived events and does not invent a feedback submission.

`source/owner-control.config.json` contract:

```json
{
  "repository": "iddunk/AstraStaff-product-progress",
  "ownerLogins": ["iddunk"],
  "pageId": "product-experience-review",
  "pageRevision": 80,
  "modules": [
    { "moduleId": "employee-home", "panelId": "A", "title": "员工首页", "recommendation": "明确工作入口", "proposalRevision": 1 }
  ]
}
```

Use unique semantic `moduleId` values. Modules may share one visual `panelId`. Update `pageRevision` when the review page changes, and increment a module's `proposalRevision` when its recommendation changes. Old accepted decisions retain their original revision in history; the client must make stale revision evidence visible rather than presenting it as acceptance of a newer proposal. To reuse this sidecar in another project, change the config repository/page/module IDs, the workflow checkout `ref` and `OWNER_LEDGER_BRANCH`, and the existing client's raw JSON URL.

## Owner feedback input

The existing page sends the following payload to the authenticated direct gateway with a fresh `crypto.randomUUID()`. The gateway writes this GitHub issue body and derives author identity from GitHub. The issue title is cosmetic and ignored by the processor. Do not place GitHub credentials in the page or invent an author field.

````text
<!-- owner-feedback:v1 -->
```json
{
  "schema_version": 1,
  "page": "product-experience-review",
  "module_id": "employee-home",
  "page_revision": 80,
  "proposal_revision": 1,
  "decision": "ADJUST_PROPOSAL",
  "comment": "希望首页先突出今日工作和需要我确认的事项。",
  "expected_latest_decision_id": null,
  "client_request_id": "11111111-1111-4111-8111-111111111111"
}
```
````

Allowed decisions are `ACCEPT`, `KEEP_CURRENT`, `ADJUST_PROPOSAL`, and `UNDECIDED`. The comment is limited to 2,000 JavaScript characters. `expected_latest_decision_id` equals the page's last observed current decision for that module, or `null` when none exists. Concurrent feedback with an old expectation records `CONFLICT` and leaves the existing current direction intact. Identical UUID resubmissions record `DUPLICATE`; reusing one UUID with changed payload records `CLIENT_REQUEST_ID_CONFLICT`.

Author, actor, issue number, and timestamps derive only from GitHub's event envelope. Both issue/comment author and acting editor must appear in `ownerLogins`. Unknown JSON keys and forged identity/status fields are rejected. Feedback from other public GitHub users can exist in the repository, but it cannot become an Owner decision. Archived rejection records omit raw bodies and retain only bounded validated fields where safe and the body's SHA-256.

Submission is durable only when that `client_request_id` appears in `entries`/`history`, with an accepted, duplicate, conflict, rejected, or validation outcome. Opening GitHub's new-issue form is not submission evidence. A test roundtrip may include optional `"validation_only": true`: it appears as `outcome: "VALIDATION"`, never enters `current`, never changes Owner direction, and is not counted as genuine Owner acceptance.

## Append-only archive and edit policy

Each trusted source observation has a stable SHA-256-derived filename under `ledger/events/github-<hash>.json`. Exclusive creation (`wx`) prevents retry overwrites. GitHub issue/comment edits append an `EDIT_RECORDED` event; their previous body, from GitHub's `changes.body.from`, also appends a history-only `SNAPSHOT` event. The original decision stays intact. To change direction, the Owner submits a new issue with a new UUID and the current expected decision ID.

A pre-edit snapshot is the immediately previous body, not necessarily the original after multiple edits. It never establishes a current direction on its own. If an edit run executes before the original opened run, a later opened delivery separately establishes the original. If the original delivery is irrecoverably missing, submit a new feedback issue; the system does not guess an original opinion.

Events retain receipt sequence, and projection order uses trusted GitHub source time, issue number, kind/entity/action, then event ID. This gives stable results when concurrent Actions runs finish in reverse order. The projection is rebuildable; event archives are the historical source.

## Separate processing acknowledgements

An allowlisted Owner login may place a structured issue comment on the decision's own issue:

````text
<!-- owner-processing:v1 -->
```json
{
  "decision_id": "github-issue:42",
  "status": "PROPOSAL_UPDATED",
  "comment": "评审页已经更新，请核对新的提案。",
  "evidence_url": "https://iddunk.github.io/AstraStaff-product-progress/product-experience-review.html"
}
```
````

Statuses are `ACKNOWLEDGED`, `PROPOSAL_UPDATED`, `PRODUCTION_ACCEPTED`, and `CONTROL_CHANGE_PROPOSAL`. The optional evidence URL must be HTTPS without URL credentials; `PRODUCTION_ACCEPTED` requires it. A receipt is attributable evidence of what the approved commenter stated, not proof the URL has been independently tested. Receipts append to the decision's `processing` and update its separate `status`; they never change `decision`, Owner comment, or revision. Edited receipts remain history-only. A proposal to change Control stays a proposal until the existing human authorization path accepts it.

## Public projection and page readback

`ledger/decisions.json` has `schema_version`, `generated_at`, `repository`, `page`, `page_revision`, `modules`, `history`, `entries`, `current`, and `conflicts`. `history` and `entries` are aliases. `current` is an array in configured module order.

An accepted decision entry contains:

```json
{
  "decision_id": "github-issue:42",
  "module_id": "employee-home",
  "page_revision": 80,
  "proposal_revision": 1,
  "decision": "ADJUST_PROPOSAL",
  "comment": "Owner public comment",
  "client_request_id": "11111111-1111-4111-8111-111111111111",
  "expected_latest_decision_id": null,
  "author": "iddunk",
  "created_at": "2026-10-10T00:00:00Z",
  "issue_number": 42,
  "outcome": "ACCEPTED",
  "status": "OPEN",
  "processing": []
}
```

History also supplies `event_id`, `sequence`, `kind`, `action`, `actor`, and `occurred_at`. Conflict entries include stable `code` and, for CAS failures, `latest_decision_id`. Rejected non-owner/raw-invalid entries may have no `client_request_id`. History outcomes are `ACCEPTED`, `CONFLICT`, `DUPLICATE`, `REJECTED`, `EDIT_RECORDED`, `SNAPSHOT`, and `VALIDATION`.

Render Owner comments with `textContent`, never `innerHTML`. All text is public; only public product information belongs in feedback. There is no private-data protection layer in this v1.

Actions commits made with `GITHUB_TOKEN` do not trigger the ordinary push-triggered Pages rebuild. The existing page therefore polls the raw committed projection directly every 60 seconds while open:

```javascript
const url = 'https://raw.githubusercontent.com/iddunk/AstraStaff-product-progress/gh-pages/ledger/decisions.json';
const response = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
if (!response.ok) throw new Error(`Ledger unavailable: ${response.status}`);
const ledger = await response.json();
```

Show unavailable/stale readback honestly. After the GitHub issue is submitted, confirm its UUID in the raw projection before displaying saved/processed status. Do not rely on localStorage as durable truth.

## Concurrent Actions publication

Checkout and setup-node actions are pinned by commit SHA; Node is pinned to `22.22.2`. The workflow uses only issue opened/edited, comment created/edited, and manual dispatch. It does not use `pull_request_target`, interpolate issue text into shells, execute issue content, post comments automatically, or force push.

A shared Actions concurrency group with `cancel-in-progress: false` still replaces older pending runs. This workflow uses a unique delivery group so every run remains scheduled. The publisher reads each latest branch head into a separate registered temporary worktree, validates the GitHub delivery, checks every previously committed event is byte-identical, appends the event, builds the projection, commits, and performs a normal non-forced push. The Git ref update serializes ledger writes. When the head advanced concurrently, it retries from a fresh branch snapshot, up to six times; exhausted retries fail visibly. No hard reset or recursive shell deletion occurs. Workflow pushes do not trigger the issues/comment workflow, and the bot actor is skipped.

## Agent read protocol

Before taking the next substantive project action, an active agent reads the existing Control document, this ledger's `current` plus applicable conflict/history, the existing `currentState`, and the user's current goal. The ledger carries Owner decisions, not instructions with higher authority than Control. If a direction and Control disagree, record/propose the conflict through the existing authorization path; do not silently overwrite Control or create a second durable execution truth.

While actively working, poll the raw projection at 60-second boundaries or before the next irreversible action. Retain ETag/Last-Modified only as a transport cache hint and re-read when changed; do not create an agent-local durable decision ledger. A sleeping or completed Codex chat is not magically awakened by GitHub changes. Monitoring outside an active turn requires an explicitly authorized existing automation/webhook mechanism.

## Validation and adoption decision

Run `node --test scripts/owner-ledger.test.mjs` and `node --check scripts/publish-owner-ledger.mjs`. Tests cover identity forgery, malicious inert text, stale revisions, authorization, UUID retries/conflicts, CAS, edits/snapshots, late original delivery, processing separation/evidence, archive overwrite guards, public probe exclusion, and out-of-order commit projection.

Decision: **ADOPT** official GitHub Issues / GitHub Actions / Git transport and Node built-in JSON/crypto/filesystem. **BUILD** only the bounded product feedback contract, append policy, CAS rule, and projection. No third-party npm package or business storage adapter is needed. GitHub APIs/platform are a hosted service; pinned Actions use MIT-licensed implementations. No provider auto-update is enabled in this workflow. Exit path: export immutable event JSON, reproject with the same contract, and replace only submission/transport in another authenticated issue system. Hosted GitHub identity, event delivery availability, public raw CDN delay, branch protection and Actions availability remain provider dependencies.

Local tests verify the contract and filesystem invariants. Live Actions execution, GitHub Issues login roundtrip, push collision retries against the real remote, and public raw/Pages readback require separate live evidence and are not claimed by this staging implementation.
