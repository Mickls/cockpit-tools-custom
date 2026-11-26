const { execFileSync } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');
const { REPO } = require('./custom-repository.cjs');
const MARKER = '<!-- cockpit-upstream-conflict-notification -->';

async function notify({ gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' }).trim(), wait = sleep } = {}) {
  if (process.env.GITHUB_REPOSITORY !== REPO) throw new Error('Invalid conflict notification repository');
  const prs = JSON.parse(gh('api', `repos/${REPO}/pulls?state=open&base=custom&per_page=100`))
    .filter(pr => /^codex\/upstream-/.test(pr.head.ref));
  for (const pr of prs) {
    let detail;
    for (let attempt = 0; attempt < 6; attempt++) {
      detail = JSON.parse(gh('api', `repos/${REPO}/pulls/${pr.number}`));
      if (detail.mergeable !== null) break;
      if (attempt < 5) await wait(2000);
    }
    if (detail.state !== 'open') continue;
    if (detail.mergeable === null) throw new Error(`GitHub has not calculated mergeability for PR #${pr.number}; retry the notification check`);
    const comments = JSON.parse(gh('api', '--paginate', '--slurp',
      `repos/${REPO}/issues/${pr.number}/comments?per_page=100`)).flat();
    const last = comments.filter(c => c.user?.login === 'github-actions[bot]' && c.body?.includes(MARKER)).at(-1);
    const previousConflict = last?.body.includes('<!-- state:conflict -->');
    const conflict = detail.mergeable === false;
    if (conflict && !previousConflict) {
      const body = `${MARKER}\n<!-- state:conflict -->\n@Mickls 官方同步 PR #${pr.number} 存在合并冲突，需要处理后才能发布客户端。\n\nPR：${detail.html_url}\n\n同一轮冲突不会每小时重复通知；冲突解决后再次出现时会重新提醒。`;
      gh('api', `repos/${REPO}/issues/${pr.number}/comments`, '--method', 'POST', '-f', `body=${body}`);
      console.log(`Created conflict notification for PR #${pr.number}`);
    } else if (!conflict && previousConflict) {
      gh('api', `repos/${REPO}/issues/${pr.number}/comments`, '--method', 'POST', '-f',
        `body=${MARKER}\n<!-- state:resolved -->\n官方同步冲突已解决，后续如再次冲突会重新提醒。`);
    } else {
      console.log(`No new conflict notification required for PR #${pr.number}`);
    }
  }
}
module.exports = { notify, MARKER };
if (require.main === module) notify().catch(error => { console.error(error.message); process.exitCode = 1; });
