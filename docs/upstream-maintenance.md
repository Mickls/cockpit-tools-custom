# 上游同步与分支维护

新仓库长期保留 `main` 和 `custom`。`main` 跟进官方代码并移除上游的 Actions 定义，`custom` 是默认分支和发布入口。临时 `codex/*` 分支通过 PR 集成，GitHub 会在合并后删除源分支。

推送到 `custom` 时触发「Check official upstream」，也可在 Actions 页面手动运行。工作流检查最新官方正式发布的 tag，并确认提交是否已包含在 `main` 和 `custom` 中。没有更新时直接结束；有更新时更新镜像并创建同步 PR；已有同一提交的 PR 时复用。

同步 PR 保留官方提交的祖先关系。请在本地解决冲突并运行 `npm run typecheck` 和 `npm run test:release`，再用合并提交集成到 `custom`。`main` 不包含活跃工作流，`custom` 仅包含官方同步和手动发布工作流；上游工作流不得进入执行目录。合并触发一次新的同步检查，但不会启动打包。允许仓库的 GitHub Actions 创建 PR，默认令牌权限保持只读。

准备发布时，按[构建与发布](custom-release.md)手动运行 `Desktop Release`。构建前再次检查锁定的源码提交是否含官方最新正式版；未同步时停止，不占用平台打包任务。不要将 Token 或签名私钥写入代码、PR 或日志。
