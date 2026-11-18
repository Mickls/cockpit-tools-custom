const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { validateIdentity, TARGETS, verifySignature, aggregate } = require('./custom-release.cjs');

function signatureFixture(data) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const keyId = crypto.randomBytes(8);
  const pub = Buffer.concat([Buffer.from('Ed'), keyId, raw]);
  const sig = crypto.sign(null, crypto.createHash('blake2b512').update(data).digest(), privateKey);
  const trusted = 'timestamp:1794873600';
  const globalSig = crypto.sign(null, Buffer.concat([sig, Buffer.from(trusted)]), privateKey);
  const text = ['untrusted comment: signature', Buffer.concat([Buffer.from('ED'), keyId, sig]).toString('base64'),
    `trusted comment: ${trusted}`, globalSig.toString('base64')].join('\n');
  return { pub: Buffer.from(`untrusted comment: public key\n${pub.toString('base64')}\n`).toString('base64'), sig: Buffer.from(text).toString('base64') };
}

test('artifact signatures reject modified payloads, wrong keys, and malformed signatures', () => {
  const data = Buffer.from('test artifact');
  const good = signatureFixture(data);
  assert.doesNotThrow(() => verifySignature(data, good.sig, good.pub));
  assert.throws(() => verifySignature(Buffer.from('tampered'), good.sig, good.pub), /Invalid artifact/);
  assert.throws(() => verifySignature(data, good.sig, signatureFixture(data).pub), /key mismatch/);
  assert.throws(() => verifySignature(data, 'invalid', good.pub), /Malformed/);
});

test('aggregation refuses a missing platform before producing a release manifest', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-aggregate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'release-assets'));
  fs.mkdirSync(path.join(root, 'src-tauri'));
  fs.writeFileSync(path.join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({ plugins: { updater: { pubkey: 'unused' } } }));
  assert.throws(() => aggregate(root, { version: '2.0.1', commit: 'a'.repeat(40), upstreamCommit: 'b'.repeat(40), publishedAt: '2026-11-17' }), /Missing or ambiguous target/);
  assert.equal(fs.existsSync(path.join(root, 'release-assets/latest.json')), false);
});

test('complete signed matrix builds fork manifests and rejects mixed provenance', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-complete-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const assets = path.join(root, 'release-assets');
  fs.mkdirSync(assets); fs.mkdirSync(path.join(root, 'src-tauri'));
  const data = Buffer.from('signed package fixture'); const key = signatureFixture(data);
  fs.writeFileSync(path.join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({ plugins: { updater: { pubkey: key.pub } } }));
  const names = ['Cockpit_aarch64.app.tar.gz', 'Cockpit_x64.app.tar.gz', 'Cockpit_universal.app.tar.gz',
    'Cockpit_2.0.1_x64_en-US.msi', 'Cockpit_2.0.1_x64-setup.exe',
    'Cockpit_2.0.1_amd64.AppImage', 'Cockpit_2.0.1_amd64.deb', 'Cockpit-2.0.1-1.x86_64.rpm',
    'Cockpit_2.0.1_aarch64.AppImage', 'Cockpit_2.0.1_arm64.deb', 'Cockpit-2.0.1-1.aarch64.rpm'];
  for (const name of names) { fs.writeFileSync(path.join(assets, name), data); fs.writeFileSync(path.join(assets, name + '.sig'), key.sig); }
  const identity = { version: '2.0.1', commit: 'a'.repeat(40), upstreamCommit: 'b'.repeat(40), publishedAt: '2026-11-17T00:00:00Z' };
  const targets = ['aarch64-apple-darwin', 'x86_64-apple-darwin', 'universal-apple-darwin',
    'x86_64-pc-windows-msvc', 'x86_64-unknown-linux-gnu', 'aarch64-unknown-linux-gnu'];
  for (const target of targets) fs.writeFileSync(path.join(assets, `provenance-${target}.json`), JSON.stringify({ ...identity, target }));
  fs.writeFileSync(path.join(root, 'release-notes.md'), '更新内容');
  aggregate(root, identity);
  const latest = JSON.parse(fs.readFileSync(path.join(assets, 'latest.json')));
  assert.equal(latest.version, identity.version);
  assert.ok(Object.values(latest.platforms).every(p => p.url.startsWith('https://github.com/Mickls/cockpit-tools/releases/download/v2.0.1/')));
  assert.ok(fs.readFileSync(path.join(assets, 'SHA256SUMS.txt'), 'utf8').includes('latest.json'));
  fs.writeFileSync(path.join(assets, 'provenance-aarch64-apple-darwin.json'), JSON.stringify({ ...identity, target: targets[0], commit: 'c'.repeat(40) }));
  assert.throws(() => aggregate(root, identity), /provenance/);
  fs.writeFileSync(path.join(assets, names[0]), 'modified');
  assert.throws(() => aggregate(root, identity), /Invalid artifact/);
});

test('custom release identity uses the numeric custom channel', () => {
  assert.doesNotThrow(() => validateIdentity({
    version: '2.0.1269',
    commit: 'a'.repeat(40),
    upstreamCommit: 'b'.repeat(40),
    publishedAt: '2026-11-17T00:00:00Z',
  }));
  assert.throws(() => validateIdentity({
    version: '1.4.0-custom.1',
    commit: 'a'.repeat(40),
    upstreamCommit: 'b'.repeat(40),
    publishedAt: '2026-11-17T00:00:00Z',
  }), /Invalid custom release identity/);
});

test('all required platform targets are explicit and stable', () => {
  assert.deepEqual(TARGETS, [
    'darwin-aarch64-app', 'darwin-x86_64-app',
    'windows-x86_64-msi', 'windows-x86_64-nsis',
    'linux-x86_64-appimage', 'linux-x86_64-deb', 'linux-x86_64-rpm',
    'linux-aarch64-appimage', 'linux-aarch64-deb', 'linux-aarch64-rpm',
  ]);
});

test('fork updater metadata points to the fork, never the official repository', () => {
  const conf = JSON.parse(fs.readFileSync(path.join(__dirname, '../../src-tauri/tauri.conf.json'), 'utf8'));
  assert.equal(conf.plugins.updater.endpoints.every(url => url.includes('Mickls/cockpit-tools')), true);
  assert.equal(conf.plugins.updater.endpoints.some(url => url.includes('jlcodes99/cockpit-tools')), false);
  assert.ok(conf.plugins.updater.pubkey.length > 40);
});

test('release configuration contains only a public updater key', () => {
  const conf = fs.readFileSync(path.join(__dirname, '../../src-tauri/tauri.conf.json'), 'utf8');
  assert.equal(conf.includes('TAURI_SIGNING_PRIVATE_KEY'), false);
  assert.equal(conf.includes('APPLE_CERTIFICATE'), false);
  assert.equal(conf.includes('jlcodes99/cockpit-tools'), false);
});
