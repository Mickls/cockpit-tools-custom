const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { uploadReleaseAssets } = require('./upload_release_assets.cjs');
const { REPO } = require('./custom-repository.cjs');
const { findRelease } = require('./custom-release-lookup.cjs');

function defaultGh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')}: ${result.stderr || result.error?.message || 'GitHub operation failed'}`);
  return result.stdout.trim();
}
function releaseFiles(root) {
  const dir = path.join(root, 'release-assets');
  const lines = fs.readFileSync(path.join(dir, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
  const hashes = new Map();
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  ([^/\\]+)$/.exec(line);
    if (!match || hashes.has(match[2])) throw new Error('Invalid checksum manifest');
    hashes.set(match[2], match[1]);
  }
  const names = fs.readdirSync(dir).sort();
  if (names.length !== hashes.size + 1 || !names.includes('latest.json') || !names.includes('custom-release.json')) throw new Error('Incomplete release asset set');
  for (const name of names) {
    const file = path.join(dir, name);
    if (!fs.lstatSync(file).isFile()) throw new Error('Unexpected release asset');
    if (name !== 'SHA256SUMS.txt' && crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== hashes.get(name)) throw new Error(`Checksum mismatch: ${name}`);
  }
  return names.map(name => ({ name, file: path.join(dir, name), size: fs.statSync(path.join(dir, name)).size,
    digest: 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex') }));
}
function uploadedAssetMatches(asset, file) {
  return asset?.state === 'uploaded' && asset.size === file.size && asset.digest === file.digest;
}
function verifyRemote(release, files, identity) {
  if (release.target_commitish !== identity.commit) throw new Error('Release source mismatch');
  if (release.assets.length !== files.length) throw new Error('Remote release asset set is incomplete');
  for (const file of files) {
    const asset = release.assets.find(a => a.name === file.name);
    if (!uploadedAssetMatches(asset, file)) throw new Error(`Remote asset mismatch: ${file.name}`);
  }
}
function newerTag(a, b) {
  const parse = value => /^v(\d+)\.(\d+)\.(\d+)$/.exec(value)?.slice(1).map(Number);
  const aa = parse(a); const bb = parse(b);
  if (!aa || !bb) throw new Error('Invalid release version');
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] > bb[i];
  return false;
}
async function publish(root, { gh = defaultGh, upload = uploadReleaseAssets, repo = process.env.GITHUB_REPOSITORY } = {}) {
  if (repo !== REPO) throw new Error('Refusing publication outside the custom repository');
  const identity = JSON.parse(fs.readFileSync(path.join(root, 'custom-release.json'), 'utf8'));
  if (!/^2\.0\.\d+$/.test(identity.version) || !/^[a-f0-9]{40}$/.test(identity.commit)) throw new Error('Invalid release identity');
  const tag = `v${identity.version}`;
  const files = releaseFiles(root);
  const lookup = () => findRelease(gh, repo, tag);
  let release = lookup();
  if (release && release.target_commitish !== identity.commit) throw new Error('Release source mismatch');
  if (release && !release.draft) { verifyRemote(release, files, identity); return 'already-published'; }
  if (!release) {
    gh(['release', 'create', tag, '--repo', repo, '--target', identity.commit, '--draft', '--title', `Cockpit Tools ${identity.version}`, '--notes-file', path.join(root, 'release-notes.md')]);
    release = lookup();
  }
  if (!release?.draft || release.target_commitish !== identity.commit || !Number.isSafeInteger(release.id)) throw new Error('Expected a matching release draft');
  const releasePath = `repos/${repo}/releases/${release.id}`;
  const missing = files.filter(file => !uploadedAssetMatches(release.assets.find(asset => asset.name === file.name), file));
  if (missing.length) {
    await upload(tag, missing.map(f => f.file), { repo });
    release = JSON.parse(gh(['api', releasePath]));
  }
  if (!release.draft || release.tag_name !== tag) throw new Error('Release draft changed before publication');
  verifyRemote(release, files, identity);
  let latest;
  try { latest = JSON.parse(gh(['api', `repos/${repo}/releases/latest`])); }
  catch (error) { if (!error.message.includes('HTTP 404')) throw error; }
  const makeLatest = !latest || !newerTag(latest.tag_name, tag);
  // Draft is only a staging state; publish as soon as the complete set is verified.
  gh(['api', releasePath, '--method', 'PATCH', '-F', 'draft=false', '-f', `make_latest=${makeLatest}`]);
  const published = JSON.parse(gh(['api', releasePath]));
  if (published.draft || published.tag_name !== tag) throw new Error('Release was not published');
  verifyRemote(published, files, identity);
  return 'published';
}
module.exports = { publish, releaseFiles, verifyRemote, newerTag };
if (require.main === module) publish(process.cwd()).then(console.log).catch(error => { console.error(error.message); process.exitCode = 1; });
