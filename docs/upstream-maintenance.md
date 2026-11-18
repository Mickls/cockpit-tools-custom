# 上游同步与分支维护

新仓库长期保留 `main` 和 `custom`。`main` 跟进官方代码并移除上游的 Actions 定义，`custom` 是默认分支和发布入口。临时 `codex/*` 分支通过 PR 集成，GitHub 会在合并后删除源分支。

维护者按需查询 `gh release view -R jlcodes99/cockpit-tools --json tagName`，从 `upstream` 获取对应 tag，并比较上游提交是否已经包含在 `main` 和 `custom` 的历史中。没有新提交时直接结束；若 `main` 已包含而 `custom` 尚未包含该提交，继续处理已有 PR，避免重复创建。

有更新时，保留上游提交的祖先关系，处理合并冲突，并确认 `main` 没有活跃工作流、`custom` 的 `.github/workflows/` 只有手动发布工作流。上游的 workflow 文件不得随更新恢复到执行目录。先在本地运行 `npm run typecheck` 和 `npm run test:release`，再通过 PR 合并到 `custom`。测试失败时保留 PR；PR 合并不会启动打包。

准备发布时，按[构建与发布](custom-release.md)手动运行 `Desktop Release`。不要将 Token 或签名私钥写入代码、PR 或日志。
