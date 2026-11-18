const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { REPO } = require('./custom-repository.cjs');
const { findRelease } = require('./custom-release-lookup.cjs');

function composeNotes(customNotes, upstreamNotes = '') {
  const custom = customNotes.map(s => s.trim()).filter(Boolean);
  if (!upstreamNotes.trim()) return custom.length
    ? `## 定制更新\n\n${custom.join('\n\n')}\n`
    : '本次发布没有单独的更新说明。\n';
  if (!custom.length) return upstreamNotes;
  return `## 定制更新\n\n${custom.join('\n\n')}\n\n## 官方更新\n\n<details>\n<summary>查看官方更新说明</summary>\n\n${upstreamNotes.trim()}\n\n</details>\n`;
}
function hasUpstreamUpdate(previous, identity) {
  return !previous || previous.upstreamCommit !== identity.upstreamCommit ||
    previous.upstreamVersion !== identity.upstreamVersion;
}
function changelogSection(text, version) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(line => line.startsWith(`## [${version}]`) || line.startsWith(`## [v${version}]`));
  if (start === -1) throw new Error(`Official changelog section not found: ${version}`);
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith('## ')) end++;
  return lines.slice(start, end).join('\n').trim();
}
function collectNotes(root, identity) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  // Reuse the snapshot from an existing release on reruns, including partial
  // uploads. Advancing latest must not rewrite an older build's notes.
  const pinned = findRelease(args => {
    const result = spawnSync('gh', args, { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Could not inspect existing release notes');
    return result.stdout;
  }, REPO, `v${identity.version}`);
  if (pinned) {
    if (pinned.target_commitish !== identity.commit || !pinned.body?.trim()) throw new Error('Existing release notes/source mismatch');
    return pinned.body;
  }
  const previous = spawnSync('gh', ['api', `repos/${REPO}/releases/latest`], { cwd: root, encoding: 'utf8' });
  let base = null;
  let previousIdentity = null;
  if (previous.status === 0) {
    const tag = JSON.parse(previous.stdout).tag_name;
    git('fetch', 'origin', `refs/tags/${tag}`);
    base = git('rev-parse', 'FETCH_HEAD^{commit}');
    const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', base, identity.commit], { cwd: root });
    if (ancestor.status === 0) {
      if (!/^v2\.0\.\d+$/.test(tag)) throw new Error('Previous release tag is invalid');
      const metadata = execFileSync('curl', ['--fail', '--silent', '--show-error', '--location',
        '--retry', '3', '--retry-all-errors', '--max-time', '15', '--retry-max-time', '45',
        `https://github.com/${REPO}/releases/download/${tag}/custom-release.json`],
      { cwd: root, encoding: 'utf8' });
      previousIdentity = JSON.parse(metadata);
      if (previousIdentity.commit !== base || `v${previousIdentity.version}` !== tag ||
        !/^[a-f0-9]{40}$/.test(previousIdentity.upstreamCommit) || !previousIdentity.upstreamVersion) {
        throw new Error('Previous release build identity is invalid');
      }
    } else {
      const newer = spawnSync('git', ['merge-base', '--is-ancestor', identity.commit, base], { cwd: root });
      if (newer.status !== 0) throw new Error('Release histories diverged');
      base = identity.commit;
      previousIdentity = identity;
    }
  } else if (!previous.stderr.includes('HTTP 404')) {
    throw new Error('Could not determine the previous release; refusing incomplete notes');
  }
  const changed = base
    ? git('diff', '--name-only', '--diff-filter=AM', base, identity.commit, '--', 'release-notes/custom')
    : git('ls-tree', '-r', '--name-only', identity.commit, '--', 'release-notes/custom');
  const fragments = changed.split('\n').filter(f => /^release-notes\/custom\/[^/]+\.md$/.test(f)).sort();
  let upstream = '';
  if (hasUpstreamUpdate(previousIdentity, identity)) {
    const official = (file) => git('show', `${identity.upstreamCommit}:${file}`);
    const version = JSON.parse(official('package.json')).version;
    if (previousIdentity?.upstreamVersion === version) {
      const commits = git('log', '--no-merges', '--format=- %h %s',
        `${previousIdentity.upstreamCommit}..${identity.upstreamCommit}`);
      upstream = `官方版本号仍为 ${version}；基线已更新至 \`${identity.upstreamCommit.slice(0, 8)}\`。${commits ? '\n\n' + commits : ''}`;
    } else {
      const release = spawnSync('gh', ['api', `repos/jlcodes99/cockpit-tools/releases/tags/v${version}`], { cwd: root, encoding: 'utf8' });
      if (release.status === 0) upstream = JSON.parse(release.stdout).body;
      if (!upstream?.trim()) upstream = '## 更新日志（中文）\n\n' + changelogSection(official('CHANGELOG.zh-CN.md'), version)
        + '\n\n## Changelog (English)\n\n' + changelogSection(official('CHANGELOG.md'), version);
    }
  }
  return composeNotes(fragments.map(f => git('show', `${identity.commit}:${f}`)), upstream);
}
module.exports = { composeNotes, changelogSection, collectNotes, hasUpstreamUpdate };
