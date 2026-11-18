const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { composeNotes } = require('./custom-notes.cjs');

test('release notes use official notes when no custom fragment changed', () => {
  assert.equal(composeNotes([], 'official release body'), 'official release body');
});
test('release notes put custom changes first and official notes below', () => {
  const notes = composeNotes(['custom change one', 'custom change two'], 'official release body');
  assert.ok(notes.indexOf('custom change one') < notes.indexOf('official release body'));
  assert.match(notes, /查看官方更新说明/);
});
test('release notes reject an empty official body', () => {
  assert.throws(() => composeNotes(['custom'], '  '), /Official release notes/);
});

const crypto = require('node:crypto');
const { publish } = require('./custom-publish.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-fixture-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const identity = { version: '2.0.1', commit: 'a'.repeat(40) };
  fs.writeFileSync(path.join(root, 'custom-release.json'), JSON.stringify(identity));
  fs.writeFileSync(path.join(root, 'release-notes.md'), '更新说明');
  const dir = path.join(root, 'release-assets'); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({ version: '2.0.1' }));
  fs.writeFileSync(path.join(dir, 'custom-release.json'), JSON.stringify(identity));
  fs.writeFileSync(path.join(dir, 'SHA256SUMS.txt'), fs.readdirSync(dir).map(name =>
    `${crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex')}  ${name}`).join('\n') + '\n');
  const assets = () => fs.readdirSync(dir).map(name => ({ name, state: 'uploaded', size: fs.statSync(path.join(dir, name)).size,
    digest: 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex') }));
  return { root, identity, assets };
}
function draft(f, assets = []) {
  return { id: 42, draft: true, tag_name: 'v2.0.1', target_commitish: f.identity.commit, assets };
}
function mockGitHub(f, initialRelease, { latest, onPublish = () => {} } = {}) {
  let remote = initialRelease;
  const calls = [];
  const gh = args => {
    calls.push(args);
    if (args[0] === 'release' && args[1] === 'create') {
      assert.equal(remote, undefined);
      remote = draft(f);
      return '';
    }
    assert.equal(args[0], 'api');
    if (args[1].endsWith('/releases/latest')) {
      if (!latest) throw new Error('HTTP 404');
      return JSON.stringify({ tag_name: latest });
    }
    if (args[1].endsWith('/releases/tags/v2.0.1')) {
      if (!remote || remote.draft) throw new Error('HTTP 404');
      return JSON.stringify(remote);
    }
    if (args[1].endsWith('/releases?per_page=100')) return remote ? '42' : '';
    assert.match(args[1], /\/releases\/42$/);
    if (args.includes('PATCH')) {
      onPublish(args);
      remote.draft = false;
    }
    return JSON.stringify(remote);
  };
  return { gh, calls, get remote() { return remote; } };
}
test('verified release publishes only after uploads and remote verification', async t => {
  const f = fixture(t); let uploaded = false;
  const mock = mockGitHub(f, undefined, { latest: 'v2.0.2', onPublish: args => {
    assert.ok(uploaded); assert.ok(args.includes('draft=false')); assert.ok(args.includes('make_latest=false'));
  } });
  const result = await publish(f.root, { repo: 'Mickls/cockpit-tools-custom', gh: mock.gh,
    upload: async () => { uploaded = true; mock.remote.assets = f.assets(); } });
  assert.equal(result, 'published'); assert.equal(mock.remote.draft, false);
});
test('an existing complete draft is verified by ID and published without reuploading', async t => {
  const f = fixture(t);
  const mock = mockGitHub(f, draft(f, f.assets()), { onPublish: args => assert.ok(args.includes('make_latest=true')) });
  const result = await publish(f.root, { repo: 'Mickls/cockpit-tools-custom', gh: mock.gh,
    upload: async () => assert.fail('Already verified assets must not be replaced') });
  assert.equal(result, 'published');
  assert.ok(mock.calls.every(args => args[0] === 'api'));
});
test('failed upload leaves the release unexposed', async t => {
  const f = fixture(t);
  const mock = mockGitHub(f, undefined, { onPublish: () => assert.fail('Partial upload must not be published') });
  await assert.rejects(publish(f.root, { repo: 'Mickls/cockpit-tools-custom', gh: mock.gh, upload: async () => { throw new Error('upload failed'); } }), /upload failed/);
  assert.equal(mock.remote.draft, true);
});
test('a partially uploaded asset set cannot be published', async t => {
  const f = fixture(t);
  const [missing, ...available] = f.assets();
  const mock = mockGitHub(f, draft(f, available), { onPublish: () => assert.fail('Partial upload must not be published') });
  await assert.rejects(publish(f.root, { repo: 'Mickls/cockpit-tools-custom', gh: mock.gh,
    upload: async (_, paths) => assert.deepEqual(paths.map(file => path.basename(file)), [missing.name]) }), /incomplete/);
});
test('rerunning an already verified public release makes no mutations', async t => {
  const f = fixture(t); const calls = [];
  const gh = args => { calls.push(args); return JSON.stringify({ draft: false, target_commitish: f.identity.commit, assets: f.assets() }); };
  const result = await publish(f.root, { repo: 'Mickls/cockpit-tools-custom', gh, upload: async () => { throw new Error('unexpected upload'); } });
  assert.equal(result, 'already-published'); assert.ok(calls.every(args => args[0] === 'api'));
});
