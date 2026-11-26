const test = require('node:test');
const assert = require('node:assert/strict');
const { main } = require('./check-official-upstream.cjs');
const { REPO } = require('./custom-repository.cjs');
const official = 'a'.repeat(40), mirror = 'b'.repeat(40), nextMirror = 'c'.repeat(40), pendingHead = 'd'.repeat(40);

function harness({ integrated = false, mirrorUpdated = true, pending = false, manualChanges = false, pendingCurrent = false } = {}) {
  const calls = [];
  let fetchedPending = false;
  const git = (...args) => {
    calls.push(['git', ...args]);
    if (args[0] === 'fetch' && args.includes('refs/heads/codex/upstream-main')) fetchedPending = true;
    if (args[0] === 'rev-parse') return args[1] === 'origin/main' ? mirror : fetchedPending ? pendingHead : official;
    if (args[0] === 'merge-base') return 'e'.repeat(40);
    if (args[0] === 'write-tree') return 'f'.repeat(40);
    if (args.includes('commit-tree')) return nextMirror;
    return '';
  };
  const gh = (...args) => {
    calls.push(['gh', ...args]);
    if (args[0] === 'pr' && args[1] === 'list') return JSON.stringify(pending
      ? [{ number: 7, headRefName: 'codex/upstream-main', headRefOid: pendingHead, url: 'https://example.invalid/pr/7' }] : []);
    return 'https://example.invalid/pr/7';
  };
  const ancestor = (a, b) => {
    if (a === official && ['origin/custom', 'HEAD'].includes(b)) return integrated;
    if (a === official && b === mirror) return mirrorUpdated;
    if (a === mirror && b === pendingHead) return pendingCurrent;
    if (a === pendingHead && b === mirror) return !manualChanges;
    return false;
  };
  return { calls, options: { git, gh, ancestor, repo: REPO } };
}

test('scheduled no-update check reads official main and performs no writes', () => {
  const h = harness({ integrated: true });
  main('sync', h.options);
  assert.ok(h.calls.some(c => c.includes('refs/heads/main')));
  assert.ok(!h.calls.some(c => c.includes('releases/latest') || c.includes('push') || c.includes('create')));
});

test('new main commits update a workflow-free mirror and create one integration PR', () => {
  const h = harness({ mirrorUpdated: false });
  main('sync', h.options);
  assert.ok(h.calls.some(c => c[1] === 'rm' && c.includes('.github/workflows')));
  assert.ok(h.calls.some(c => c[1] === 'push' && c.includes(nextMirror + ':refs/heads/main')));
  assert.equal(h.calls.filter(c => c[0] === 'gh' && c[2] === 'create').length, 1);
  assert.ok(h.calls.some(c => c.includes(nextMirror + ':refs/heads/codex/upstream-main')));
});

test('a pending upstream PR is advanced without opening a second PR', () => {
  const h = harness({ pending: true });
  main('sync', h.options);
  assert.ok(h.calls.some(c => c.includes(mirror + ':refs/heads/codex/upstream-main')));
  assert.ok(!h.calls.some(c => c.includes('create') || c.includes('--force')));
});

test('unchanged pending upstream PR creates neither a commit nor a push', () => {
  const h = harness({ pending: true, pendingCurrent: true });
  main('sync', h.options);
  assert.ok(!h.calls.some(c => c.includes('push') || c.includes('commit-tree') || c.includes('create')));
});

test('manual conflict resolution commits are never overwritten', () => {
  const h = harness({ pending: true, manualChanges: true });
  assert.throws(() => main('sync', h.options), /manual changes/);
  assert.ok(!h.calls.some(c => c.includes('push') || c.includes('--force') || c.includes('create')));
});

test('build preflight blocks an older main snapshot but accepts an integrated snapshot', () => {
  assert.throws(() => main('check', harness().options), /main@aaaaaaaa/);
  const h = harness({ integrated: true });
  main('check', h.options);
  assert.ok(!h.calls.some(c => c[0] === 'gh' || c.includes('push')));
});
