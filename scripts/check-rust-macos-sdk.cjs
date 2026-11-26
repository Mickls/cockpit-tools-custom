// Run cargo check using an explicitly chosen installed SDK, without changing
// xcode-select, SDK symlinks, or the normal build configuration.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const sdk = process.argv[2];
if (process.platform !== 'darwin' || !sdk || !fs.existsSync(path.join(sdk, 'SDKSettings.json'))) {
  console.error('Usage on macOS: node scripts/check-rust-macos-sdk.cjs /absolute/path/to/MacOSX.sdk');
  process.exit(1);
}
const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-sdk-'));
try {
  fs.writeFileSync(path.join(wrapperDir, 'xcrun'), `#!/bin/sh
if [ "$1" = "--sdk" ] && [ "$2" = "macosx" ] && [ "$3" = "--show-sdk-path" ]; then
  printf '%s\\n' "$COCKPIT_CHECK_SDK"
else
  exec /usr/bin/xcrun "$@"
fi
`, { mode: 0o700 });
  const cargoArgs = process.argv.slice(3);
  const result = spawnSync('cargo', cargoArgs.length ? cargoArgs : ['check', '--manifest-path', 'src-tauri/Cargo.toml'], {
    cwd: path.resolve(__dirname, '..'), stdio: 'inherit',
    env: { ...process.env, COCKPIT_CHECK_SDK: path.resolve(sdk), PATH: wrapperDir + path.delimiter + process.env.PATH },
  });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(wrapperDir, { recursive: true, force: true });
}
