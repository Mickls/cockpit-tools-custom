const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { buildTargetManifests, TARGET_SPECS } = require('./build_target_latest_json.cjs');

const { REPO } = require('./custom-repository.cjs');
const TARGETS = [
  'darwin-aarch64-app', 'windows-x86_64-msi', 'windows-x86_64-nsis',
  'linux-x86_64-appimage', 'linux-x86_64-deb', 'linux-x86_64-rpm',
];
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); }
function validateIdentity(identity) {
  if (!/^2\.0\.\d+$/.test(identity.version) || !/^[a-f0-9]{40}$/.test(identity.commit)
    || !/^[a-f0-9]{40}$/.test(identity.upstreamCommit) || !Number.isFinite(Date.parse(identity.publishedAt))) {
    throw new Error('Invalid custom release identity');
  }
}
function prepare(root, identity) {
  validateIdentity(identity);
  const pkgPath = path.join(root, 'package.json');
  const pkg = readJson(pkgPath); pkg.version = identity.version; writeJson(pkgPath, pkg);
  const lockPath = path.join(root, 'package-lock.json');
  const lock = readJson(lockPath); lock.version = identity.version;
  if (lock.packages?.['']) lock.packages[''].version = identity.version;
  writeJson(lockPath, lock);
  const confPath = path.join(root, 'src-tauri/tauri.conf.json');
  const conf = readJson(confPath); conf.version = identity.version;
  conf.bundle.macOS.signingIdentity = '-';
  writeJson(confPath, conf);
  const cargoPath = path.join(root, 'src-tauri/Cargo.toml');
  fs.writeFileSync(cargoPath, fs.readFileSync(cargoPath, 'utf8').replace(/^version\s*=\s*"[^"]+"/m, `version = "${identity.version}"`));
  writeJson(path.join(root, 'custom-release.json'), identity);
  fs.writeFileSync(path.join(root, 'release-notes.md'), identity.releaseNotes || require('./custom-notes.cjs').collectNotes(root, identity));
}

function verifySignature(data, signatureText, publicKeyText) {
  const publicLines = Buffer.from(publicKeyText.trim(), 'base64').toString('utf8').trim().split(/\r?\n/);
  const publicBytes = Buffer.from(publicLines[publicLines.length - 1], 'base64');
  const lines = Buffer.from(signatureText.trim(), 'base64').toString('utf8').trim().split(/\r?\n/);
  if (publicBytes.length !== 42 || lines.length !== 4 || !lines[2].startsWith('trusted comment: ')) throw new Error('Malformed update signature');
  const sig = Buffer.from(lines[1], 'base64');
  if (sig.length !== 74 || !sig.subarray(2, 10).equals(publicBytes.subarray(2, 10))) throw new Error('Update key mismatch');
  const algorithm = sig.subarray(0, 2).toString();
  if (!['Ed', 'ED'].includes(algorithm)) throw new Error('Unsupported update signature');
  const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), publicBytes.subarray(10)]), format: 'der', type: 'spki' });
  const message = algorithm === 'ED' ? crypto.createHash('blake2b512').update(data).digest() : data;
  if (!crypto.verify(null, message, key, sig.subarray(10))) throw new Error('Invalid artifact signature');
  const trusted = Buffer.from(lines[2].slice('trusted comment: '.length));
  if (!crypto.verify(null, Buffer.concat([sig.subarray(10), trusted]), key, Buffer.from(lines[3], 'base64'))) throw new Error('Invalid signature comment');
}

function aggregate(root, identity) {
  validateIdentity(identity);
  const assets = path.join(root, 'release-assets');
  const files = fs.readdirSync(assets);
  const conf = readJson(path.join(root, 'src-tauri/tauri.conf.json'));
  // Require every platform and provenance before creating any release.
  for (const target of TARGETS) {
    const matches = files.filter(f => TARGET_SPECS[target].test(f));
    if (matches.length !== 1) throw new Error(`Missing or ambiguous target: ${target}`);
    const name = matches[0];
    verifySignature(fs.readFileSync(path.join(assets, name)), fs.readFileSync(path.join(assets, name + '.sig'), 'utf8'), conf.plugins.updater.pubkey);
  }
  const provenance = files.filter(f => /^provenance-.*\.json$/.test(f)).map(f => readJson(path.join(assets, f)));
  const expected = ['aarch64-apple-darwin', 'x86_64-pc-windows-msvc', 'x86_64-unknown-linux-gnu'];
  if (provenance.length !== expected.length || expected.some(target => !provenance.some(p => p.target === target))
    || provenance.some(p => p.commit !== identity.commit || p.version !== identity.version)) throw new Error('Mixed or missing platform provenance');
  const manifests = buildTargetManifests({ version: identity.version, repo: REPO, assetsDir: assets,
    notesFile: path.join(root, 'release-notes.md'), publishedAt: identity.publishedAt, outputDir: assets, targets: TARGETS });
  const platforms = {};
  for (const [index, target] of TARGETS.entries()) {
    const { url, signature } = readJson(manifests[index]);
    platforms[target] = { url, signature };
  }
  platforms['darwin-aarch64'] = platforms['darwin-aarch64-app'];
  platforms['windows-x86_64'] = platforms['windows-x86_64-msi'];
  platforms['linux-x86_64'] = platforms['linux-x86_64-appimage'];
  const { version, notes, pub_date } = readJson(manifests[0]);
  writeJson(path.join(assets, 'latest.json'), { version, notes, pub_date, platforms });
  writeJson(path.join(assets, 'custom-release.json'), identity);
  const sums = fs.readdirSync(assets).filter(f => f !== 'SHA256SUMS.txt').sort().map(f =>
    `${crypto.createHash('sha256').update(fs.readFileSync(path.join(assets, f))).digest('hex')}  ${f}`);
  fs.writeFileSync(path.join(assets, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
}

function main() {
  const mode = process.argv[2]; const root = process.cwd();
  if (mode === 'identity') {
    const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
    const identity = { version: `2.0.${git('rev-list', '--first-parent', '--count', 'HEAD')}`,
      commit: git('rev-parse', 'HEAD'), upstreamCommit: git('merge-base', 'HEAD', 'origin/main'),
      upstreamVersion: readJson('package.json').version,
      publishedAt: git('show', '-s', '--format=%cI', 'HEAD') };
    validateIdentity(identity); identity.releaseNotes = require('./custom-notes.cjs').collectNotes(root, identity); writeJson('custom-release.json', identity);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${identity.version}\ncommit=${identity.commit}\n`);
  } else if (mode === 'prepare') prepare(root, readJson('custom-release.json'));
  else if (mode === 'aggregate') aggregate(root, readJson('custom-release.json'));
  else throw new Error('Unknown custom release command');
}
module.exports = { prepare, aggregate, validateIdentity, verifySignature, TARGETS };
if (require.main === module) main();
