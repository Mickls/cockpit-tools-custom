const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { stageReleaseAssets } = require('./stage_release_assets.cjs');
const { verifySignature } = require('./custom-release.cjs');

const target = process.env.TARGET;
const platform = process.env.PLATFORM;
const identity = JSON.parse(fs.readFileSync('custom-release.json', 'utf8'));
const publicKey = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8')).plugins.updater.pubkey;
const files = stageReleaseAssets({ platform, macArch: process.env.MAC_ARCH,
  assetsDir: path.join('target', target, 'release/bundle'), outputDir: 'release-assets' });
for (const file of files.filter(f => !f.endsWith('.sig'))) {
  // NSIS and native Linux installers need their own update signatures too.
  execFileSync(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', 'signer', 'sign', file],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  verifySignature(fs.readFileSync(file), fs.readFileSync(file + '.sig', 'utf8'), publicKey);
}
fs.writeFileSync(path.join('release-assets', `provenance-${target}.json`),
  JSON.stringify({ ...identity, target, appleSigned: false, appleNotarized: false }, null, 2));
