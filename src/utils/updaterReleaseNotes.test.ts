import assert from 'node:assert/strict';
import test from 'node:test';
import { parseUpdaterReleaseNotes } from './updaterReleaseNotes.ts';

const bilingual = '## 更新日志（中文）\n\n- 官方修复\n\n## Changelog (English)\n\n- Upstream fix';

test('combined release notes retain the custom section in both languages', () => {
  const notes = parseUpdaterReleaseNotes(
    '## 定制更新\n\n- 长期配对码\n\n## 官方更新\n\n<details>\n<summary>查看官方更新说明</summary>\n\n'
    + bilingual + '\n\n</details>',
  );
  assert.equal(notes.releaseNotesZh, '## 定制更新\n\n- 长期配对码\n\n## 官方更新\n\n- 官方修复');
  assert.equal(notes.releaseNotes, '## 定制更新\n\n- 长期配对码\n\n## Upstream updates\n\n- Upstream fix');
});

test('custom-only and upstream-only notes remain readable', () => {
  const custom = '## 定制更新\n\n- 修复更新提示';
  assert.deepEqual(parseUpdaterReleaseNotes(custom), { releaseNotes: custom, releaseNotesZh: custom });
  assert.deepEqual(parseUpdaterReleaseNotes(bilingual), { releaseNotes: '- Upstream fix', releaseNotesZh: '- 官方修复' });
});
