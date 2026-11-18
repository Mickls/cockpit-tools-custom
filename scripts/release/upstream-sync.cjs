const { execFileSync, spawnSync } = require('node:child_process');

const UPSTREAM = 'jlcodes99/cockpit-tools';

function planUpdate({ releaseSha, mainSha, customSha, isAncestor }) {
  for (const sha of [releaseSha, mainSha, customSha]) {
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid commit SHA');
  }
  if (!isAncestor(releaseSha, mainSha) && !isAncestor(mainSha, releaseSha)) {
    throw new Error('Upstream history diverged; refusing to force-push main');
  }
  // An initial fork may already be ahead of the most recent official release.
  const target = isAncestor(releaseSha, mainSha) ? mainSha : releaseSha;
  return {
    target,
    updateMain: target !== mainSha,
    integrate: !isAncestor(target, customSha),
    branch: `codex/upstream-${target}`,
  };
}

function synchronize({ plan, existing, actions }) {
  if (plan.updateMain) actions.updateMain(plan.target);
  if (!plan.integrate) return 'already-integrated';
  if (existing) {
    actions.resume(existing);
    return 'resumed';
  }
  actions.create(plan.branch, plan.target);
  return 'created';
}

function execute({ repo, cwd = process.cwd() }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || repo === UPSTREAM) {
    throw new Error('A fork repository in owner/name format is required');
  }
  const run = (bin, args) => execFileSync(bin, args, { cwd, encoding: 'utf8' }).trim();
  const git = (...args) => run('git', args);
  const gh = (...args) => run('gh', args);
  const api = (...args) => JSON.parse(gh('api', ...args));
  const isAncestor = (a, b) => {
    const result = spawnSync('git', ['merge-base', '--is-ancestor', a, b], { cwd });
    if (result.error || result.status > 1 || result.status === null) {
      throw new Error('Could not inspect Git ancestry');
    }
    return result.status === 0;
  };

  const release = api(`repos/${UPSTREAM}/releases/latest`);
  if (release.draft || release.prerelease || !release.tag_name) throw new Error('Expected a stable release');
  // Keep upstream tags isolated from fork release tags.
  git('check-ref-format', `refs/tags/${release.tag_name}`);
  git('fetch', 'origin', '+refs/heads/main:refs/remotes/origin/main', '+refs/heads/custom:refs/remotes/origin/custom');
  git('fetch', `https://github.com/${UPSTREAM}.git`, `refs/tags/${release.tag_name}`);
  const releaseSha = git('rev-parse', 'FETCH_HEAD^{commit}');
  const plan = planUpdate({
    releaseSha,
    mainSha: git('rev-parse', 'origin/main^{commit}'),
    customSha: git('rev-parse', 'origin/custom^{commit}'),
    isAncestor,
  });
  const prs = plan.integrate
    ? JSON.parse(gh('pr', 'list', '--repo', repo, '--base', 'custom', '--head', plan.branch,
      '--state', 'open', '--json', 'number')) : [];
  const resume = (pr) => {
    const state = api(`repos/${repo}/pulls/${pr.number}`);
    if (state.mergeable === false) {
      console.log(`PR #${pr.number} has conflicts; resolve manually. No release was triggered.`);
      return;
    }
    // GitHub rechecks required status checks and base freshness at merge time.
    gh('pr', 'merge', String(pr.number), '--repo', repo, '--merge', '--auto');
  };
  const result = synchronize({ plan, existing: prs[0], actions: {
    updateMain: (target) => git('push', 'origin', `${target}:refs/heads/main`),
    resume,
    create: (branch, target) => {
      // Push only the upstream commit: GitHub can show merge conflicts without
      // ever attempting to commit an unresolved merge index.
      git('push', 'origin', `${target}:refs/heads/${branch}`);
      const body = `同步官方正式版本 ${release.tag_name}。\n\n集成目标提交：${target}\n` +
        '全部必需检查通过且无冲突后才合并；合并采用 merge commit 保留上游祖先关系，源分支自动删除。';
      gh('pr', 'create', '--repo', repo, '--base', 'custom', '--head', branch,
        '--title', `同步官方 Cockpit Tools ${release.tag_name}`, '--body', body);
      const created = JSON.parse(gh('pr', 'list', '--repo', repo, '--head', branch,
        '--base', 'custom', '--state', 'open', '--json', 'number'));
      if (created.length !== 1) throw new Error('Could not identify the created update PR');
      resume(created[0]);
    },
  } });
  console.log(`Upstream synchronization: ${result}; target=${plan.target}`);
  return result;
}

module.exports = { planUpdate, synchronize, execute };
if (require.main === module) {
  try { execute({ repo: process.env.GITHUB_REPOSITORY }); }
  catch (error) {
    // Do not print subprocess stderr or request headers that may contain secrets.
    console.error(`Upstream synchronization failed: ${error.status ? 'Git/GitHub operation failed; inspect repository permissions and pending PRs' : error.message}`);
    process.exitCode = 1;
  }
}
