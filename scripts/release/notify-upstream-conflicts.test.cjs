const test = require('node:test');
const assert = require('node:assert/strict');
const { notify, MARKER } = require('./notify-upstream-conflicts.cjs');
const { REPO } = require('./custom-repository.cjs');

function fixture({ conflict = true, previous, unknown = false, author = 'github-actions[bot]' } = {}) {
  const writes = [];
  const gh = (...args) => {
    if (args.includes('POST')) { writes.push(args); return '{}'; }
    const url = args.find(a => a.startsWith('repos/'));
    if (url.includes('/pulls?')) return JSON.stringify([{ number: 8, head: { ref: 'codex/upstream-main' } }]);
    if (url.includes('/comments')) return JSON.stringify([previous === undefined ? [] : [{
      user: { login: author }, body: MARKER + `\n<!-- state:${previous ? 'conflict' : 'resolved'} -->`,
    }]]);
    return JSON.stringify({ state: 'open', mergeable: unknown ? null : !conflict, html_url: 'https://example.test/pull/8' });
  };
  return { gh, writes, wait: async () => {} };
}

test('conflict notifications mention the owner once and resume after resolution', async () => {
  const saved = process.env.GITHUB_REPOSITORY;
  process.env.GITHUB_REPOSITORY = REPO;
  try {
    for (const [options, count] of [
      [{}, 1], [{ previous: true }, 0], [{ previous: false }, 1],
      [{ conflict: false, previous: true }, 1], [{ conflict: false }, 0],
      [{ previous: true, author: 'someone-else' }, 1],
    ]) {
      const f = fixture(options);
      await notify(f);
      assert.equal(f.writes.length, count);
      if (count && options.conflict !== false) assert.ok(f.writes[0].some(a => a.includes('@Mickls')));
    }
    const unknown = fixture({ unknown: true });
    await assert.rejects(notify(unknown), /has not calculated/);
    assert.equal(unknown.writes.length, 0);
  } finally {
    if (saved === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = saved;
  }
});
