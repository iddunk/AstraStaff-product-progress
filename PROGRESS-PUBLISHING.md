# Owner Progress Publishing Contract

This repository is the Owner-facing product control surface for delivery progress. Git history preserves old facts; the live Page must represent the newest verified truth.

## Mandatory update triggers

Update the Page immediately when any of these changes: production deployment state, current blocker, next executable step, Owner action required, acceptance count, or a previously stated blocker is cleared. Do not wait for a phase to finish.

During active P0 / first-customer work, publish material progress at least every 5 minutes when state is changing. If nothing material changed, do not invent progress; keep the last verified timestamp visible.

## Required Owner fields

Every active product line must make these obvious: **current step / doing / blocker / next / Owner needed or not / last verified time / evidence boundary**.

If Owner action is required, surface it in both the Page and the active chat immediately. If no Owner action is required, state that explicitly.

## Truth rules

Production readback beats old notes. Cleared blockers must be removed from the live Page on the same update. Candidate, local test, merge, deploy, evaluation, review and customer acceptance remain distinct states. Customer acceptance is never inferred.

Old worktrees and stale local files are not durable truth. Preserve useful history through Git commits, then remove obsolete paths so future work starts from current committed state.

## Owner readability rule

The live Owner pages are decision surfaces, not engineering ledgers. Keep the first screen in plain language. Separate **candidate code / production deployed / customer accepted**. Do not make normal release, evaluation, migration, SHA or employee patch-version evidence an Owner action. Detailed technical evidence remains in `source/product-state.json`, PRs and Git history.

## Owner dashboard presentation rules

The live Owner view is a control board, not an engineering log. Its first screen must always show: **overall product progress / each major product line progress / current node / next node / Owner action required or not**.

Progress percentages are management estimates derived from explicitly listed key product nodes and business weighting. They are **not** engineering effort, commit count, test count, or elapsed time. A percentage should move materially only when a product node is crossed or a previously proven node regresses.

Every major product line must show its full node chain. Use the following visual states consistently: `✅ proven`, `🔵 capability ready but not yet joined in the latest E2E`, `🟡 current node`, `⚪ not reached`, `🔴 blocked/regressed`.

Avoid vague status phrases such as “today integrating”, “still progressing”, “continuing development”, or long lists of changed code. Replace them with the exact current product node and the one next node. Detailed SHAs, migrations, evaluation counts and build receipts belong in the evidence layer, not the Owner first screen.

Screenshots or simple stage diagrams should carry more of the communication load than prose. Public screenshots must keep their evidence boundary explicit: synthetic/local/test data must never be presented as merchant/customer production data.
