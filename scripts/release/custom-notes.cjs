const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

function composeNotes(customNotes, upstreamNotes) {
  const custom = customNotes.map(s => s.trim()).filter(Boolean);
  if (!upstreamNotes.trim()) throw new Error('Official release notes are missing');
  if (!custom.length) return upstreamNotes;
  return `## 定制更新\n\n${custom.join('\n\n')}\n\n## 官方更新\n\n<details>\n<summary>查看官方更新说明</summary>\n\n${upstreamNotes.trim()}\n\n</details>\n`;
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
  const existing = spawnSync('gh', ['api', `repos/Mickls/cockpit-tools/releases/tags/v${identity.version}`], { cwd: root, encoding: 'utf8' });
  if (existing.status === 0) {
    const pinned = JSON.parse(existing.stdout);
    if (pinned.target_commitish !== identity.commit || !pinned.body?.trim()) throw new Error('Existing release notes/source mismatch');
    return pinned.body;
  }
  if (!existing.stderr.includes('HTTP 404')) throw new Error('Could not inspect existing release notes');
  const official = (file) => git('show', `${identity.upstreamCommit}:${file}`);
  const version = JSON.parse(official('package.json')).version;
  let upstream;
  const release = spawnSync('gh', ['api', `repos/jlcodes99/cockpit-tools/releases/tags/v${version}`], { cwd: root, encoding: 'utf8' });
  if (release.status === 0) upstream = JSON.parse(release.stdout).body;
  // The upstream changelog is pinned to the same commit when GitHub is unavailable.
  if (!upstream?.trim()) upstream = changelogSection(official('CHANGELOG.zh-CN.md'), version) + '\n\n' + changelogSection(official('CHANGELOG.md'), version);
  const previous = spawnSync('gh', ['api', 'repos/Mickls/cockpit-tools/releases/latest'], { cwd: root, encoding: 'utf8' });
  let base = null;
  if (previous.status === 0) {
    const tag = JSON.parse(previous.stdout).tag_name;
    git('fetch', 'origin', `refs/tags/${tag}`);
    base = git('rev-parse', 'FETCH_HEAD^{commit}');
    const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', base, identity.commit], { cwd: root });
    if (ancestor.status !== 0) {
      const newer = spawnSync('git', ['merge-base', '--is-ancestor', identity.commit, base], { cwd: root });
      if (newer.status !== 0) throw new Error('Release histories diverged');
      base = identity.commit;
    }
  } else if (!previous.stderr.includes('HTTP 404')) {
    throw new Error('Could not determine the previous release; refusing incomplete notes');
  }
  const changed = base
    ? git('diff', '--name-only', '--diff-filter=AM', base, identity.commit, '--', 'release-notes/custom')
    : git('ls-tree', '-r', '--name-only', identity.commit, '--', 'release-notes/custom');
  const fragments = changed.split('\n').filter(f => /^release-notes\/custom\/[^/]+\.md$/.test(f)).sort();
  return composeNotes(fragments.map(f => git('show', `${identity.commit}:${f}`)), upstream);
}
module.exports = { composeNotes, changelogSection, collectNotes };
