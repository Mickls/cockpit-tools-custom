const { execFileSync, spawnSync } = require('node:child_process');
const { REPO } = require('./custom-repository.cjs');
const UPSTREAM = 'jlcodes99/cockpit-tools';

function main(mode) {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' }).trim();
  const ancestor = (a, b) => {
    const r = spawnSync('git', ['merge-base', '--is-ancestor', a, b]);
    if (![0, 1].includes(r.status)) throw new Error('Could not verify upstream ancestry');
    return r.status === 0;
  };
  if (process.env.GITHUB_REPOSITORY !== REPO || !['check', 'sync'].includes(mode)) throw new Error('Invalid upstream check context');
  const latest = JSON.parse(gh('api', `repos/${UPSTREAM}/releases/latest`));
  const tag = latest.tag_name;
  if (latest.draft || latest.prerelease || !/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('Expected an official stable tag');
  git('fetch', '--no-tags', `https://github.com/${UPSTREAM}.git`, `refs/tags/${tag}`);
  const official = git('rev-parse', 'FETCH_HEAD^{commit}');
  if (mode === 'check') {
    if (!ancestor(official, 'HEAD')) throw new Error(`当前构建提交尚未合入官方 ${tag}。请先合并上游同步 PR，再手动运行打包。`);
    console.log(`Build includes official ${tag} (${official}).`);
    return;
  }

  git('fetch', 'origin', 'main', 'custom');
  const mirror = git('rev-parse', 'origin/main');
  if (ancestor(official, 'origin/custom') && ancestor(official, mirror)) {
    console.log(`Official ${tag} is already integrated; no changes.`);
    return;
  }
  const branch = `codex/upstream-${official}`;
  const prs = JSON.parse(gh('pr', 'list', '--repo', REPO, '--base', 'custom', '--head', branch, '--state', 'open', '--json', 'url'));
  if (prs.length) { console.log(`Upstream PR pending: ${prs[0].url}`); return; }
  let target = mirror;
  if (!ancestor(official, mirror)) {
    const previousOfficial = git('merge-base', mirror, official);
    if (!previousOfficial || git('diff', previousOfficial, mirror, '--', '.', ':(exclude).github/workflows')) {
      throw new Error('The mirror has changes outside workflow removal; reconcile it manually');
    }
    // Build the mirror tree without any executable upstream workflows.
    git('read-tree', official);
    git('rm', '--cached', '-r', '--ignore-unmatch', '--', '.github/workflows');
    const tree = git('write-tree');
    target = git('-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
      'commit-tree', tree, '-p', mirror, '-p', official, '-m', `Mirror official ${tag} without upstream workflows`);
    git('push', 'origin', `${target}:refs/heads/main`);
  }
  if (ancestor(official, 'origin/custom')) return;
  const existing = git('ls-remote', 'origin', `refs/heads/${branch}`);
  if (!existing) git('push', 'origin', `${target}:refs/heads/${branch}`);
  else if (existing.split(/\s/)[0] !== target) throw new Error('Existing sync branch differs; inspect it before retrying');
  console.log(gh('pr', 'create', '--repo', REPO, '--base', 'custom', '--head', branch,
    '--title', `同步官方 Cockpit Tools ${tag}`,
    '--body', '合并前请处理冲突并验证定制功能。请保留 merge commit，避免丢失官方提交的祖先关系。'));
}

if (require.main === module) {
  try { main(process.argv[2]); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
