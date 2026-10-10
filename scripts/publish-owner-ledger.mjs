import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processDelivery, rebuild } from './owner-ledger.mjs';

const git = (root, args, options = {}) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();

export async function assertAppendOnly(before, after) {
  let names;
  try { names = await readdir(before); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const name of names.filter((item) => item.endsWith('.json'))) {
    const [original, current] = await Promise.all([readFile(path.join(before, name)), readFile(path.join(after, name))]);
    if (!original.equals(current)) throw new Error('EVENT_HISTORY_OVERWRITE_FORBIDDEN');
  }
}

export async function publish({ root, branch, payload, eventName, attempts = 6 }) {
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('PUBLISH_REQUIRES_GITHUB_ACTIONS');
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) || branch.includes('..') || branch.endsWith('/') || branch.includes('//')) throw new Error('INVALID_LEDGER_BRANCH');
  const config = JSON.parse(await readFile(path.join(root, 'source/owner-control.config.json'), 'utf8'));
  if (process.env.GITHUB_REPOSITORY?.toLowerCase() !== config.repository.toLowerCase()) throw new Error('REPOSITORY_MISMATCH');
  const expectedRemote = `https://github.com/${config.repository}`.toLowerCase();
  const actualRemote = git(root, ['remote', 'get-url', 'origin']).replace(/\.git$/, '').toLowerCase();
  if (actualRemote !== expectedRemote) throw new Error('UNEXPECTED_GIT_REMOTE');
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    git(root, ['fetch', '--no-tags', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
    const base = git(root, ['rev-parse', `refs/remotes/origin/${branch}`]);
    const temp = await mkdtemp(path.join(os.tmpdir(), 'owner-ledger-'));
    const worktree = path.join(temp, 'checkout');
    git(root, ['worktree', 'add', '--detach', worktree, base]);
    try {
      // Read the newest config/ledger in this worktree on every retry. Nothing
      // from an unsuccessful commit becomes authoritative.
      if (eventName === 'workflow_dispatch') await rebuild(worktree);
      else await processDelivery({ root: worktree, payload, eventName });
      // Git worktree base itself owns the original snapshots: compare directly
      // against committed bytes, including every original archived JSON.
      const names = git(worktree, ['ls-tree', '-r', '--name-only', base, '--', 'ledger/events']).split('\n').filter(Boolean);
      for (const name of names) {
        const original = execFileSync('git', ['-C', worktree, 'show', `${base}:${name}`]);
        const updated = await readFile(path.join(worktree, name));
        if (!original.equals(updated)) throw new Error('EVENT_HISTORY_OVERWRITE_FORBIDDEN');
      }
      // The first dispatch/unrelated issue may produce only the projection,
      // before any events directory exists. Stage the known ledger subtree.
      git(worktree, ['add', '--', 'ledger']);
      if (!git(worktree, ['diff', '--cached', '--name-only'])) return { pushed: false, attempt, unchanged: true };
      git(worktree, ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
        'commit', '-m', 'Record owner feedback ledger']);
      const commit = git(worktree, ['rev-parse', 'HEAD']);
      try {
        // Normal non-forced ref update is the global serialization point.
        git(root, ['push', 'origin', `${commit}:refs/heads/${branch}`]);
        return { pushed: true, attempt, commit };
      } catch (error) {
        const latest = git(root, ['ls-remote', 'origin', `refs/heads/${branch}`]).split(/\s+/)[0];
        if (latest === base || attempt === attempts) throw error;
        console.log(`Ledger branch advanced; retrying from the latest commit (${attempt}/${attempts}).`);
      }
    } finally {
      // Only Git's registered temporary checkout is removed; no recursive
      // shell deletion, hard reset, or force push is used.
      git(root, ['worktree', 'remove', '--force', worktree]);
    }
  }
  throw new Error('LEDGER_PUSH_RETRY_EXHAUSTED');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const payload = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  console.log(JSON.stringify(await publish({ root: process.cwd(), branch: process.env.OWNER_LEDGER_BRANCH ?? 'gh-pages', payload, eventName: process.env.GITHUB_EVENT_NAME })));
}
