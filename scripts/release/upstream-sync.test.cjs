const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { planUpdate, synchronize } = require('./upstream-sync.cjs');

function history(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'cockpit-sync-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git('init', '--quiet');
  git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  const commit = (message) => { git('commit', '--allow-empty', '--quiet', '-m', message); return git('rev-parse', 'HEAD'); };
  const first = commit('base'); const second = commit('release');
  git('checkout', '--quiet', '--detach', first);
  const custom = commit('custom');
  return { first, second, custom, isAncestor: (a, b) => spawnSync('git', ['merge-base', '--is-ancestor', a, b], { cwd }).status === 0 };
}

function record(plan, existing) {
  const calls = [];
  const actions = Object.fromEntries(['updateMain', 'create', 'resume'].map(k => [k, (...args) => calls.push([k, ...args])]));
  const result = synchronize({ plan, existing, actions });
  return { calls, result };
}

test('no update and already integrated creates no branch, PR, push or merge', t => {
  const h = history(t);
  const p = planUpdate({ ...h, releaseSha: h.first, mainSha: h.first, customSha: h.custom });
  assert.deepEqual(record(p).calls, []);
});
test('new release advances main and creates exactly one SHA-named PR', t => {
  const h = history(t);
  const p = planUpdate({ ...h, releaseSha: h.second, mainSha: h.first, customSha: h.custom });
  assert.deepEqual(record(p).calls, [['updateMain', h.second], ['create', `codex/upstream-${h.second}`, h.second]]);
});
test('main already advanced but pending PR is resumed rather than skipped or duplicated', t => {
  const h = history(t);
  const p = planUpdate({ ...h, releaseSha: h.second, mainSha: h.second, customSha: h.custom });
  assert.deepEqual(record(p, { number: 7 }).calls, [['resume', { number: 7 }]]);
});
test('a lost PR can be recreated after main advances', t => {
  const h = history(t);
  const p = planUpdate({ ...h, releaseSha: h.second, mainSha: h.second, customSha: h.custom });
  assert.deepEqual(record(p).calls, [['create', p.branch, h.second]]);
});
test('initial main ahead of latest release is never rewound', t => {
  const h = history(t);
  const p = planUpdate({ ...h, releaseSha: h.first, mainSha: h.second, customSha: h.custom });
  assert.equal(p.updateMain, false); assert.equal(p.target, h.second);
});
test('divergent official history stops before mutations', t => {
  const h = history(t);
  assert.throws(() => planUpdate({ ...h, releaseSha: h.second, mainSha: h.custom, customSha: h.custom }), /diverged/);
});
