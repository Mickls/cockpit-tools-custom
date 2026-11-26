# Cockpit Tools

基于 [jlcodes99/cockpit-tools](https://github.com/jlcodes99/cockpit-tools) 的定制分支，围绕多设备 Codex 账号管理、凭据恢复和持续跟进官方更新扩展。

[下载 Release](https://github.com/Mickls/cockpit-tools-custom/releases) · [官方仓库](https://github.com/jlcodes99/cockpit-tools) · [官方 README](https://github.com/jlcodes99/cockpit-tools/blob/main/README.md) · [凭据同步服务](https://github.com/Mickls/cockpit-credential-sync-server)

## 定制功能

### 持续跟进官方更新

- 长期保留 `main` 和 `custom` 两个分支：`main` 跟进官方，`custom` 集成定制功能。
- 每小时及推送到 `custom` 时检查官方 `main` 的最新提交；没有更新时不创建分支、PR 或合并。
- 更新通过临时 PR 集成，合并前在本地验证，合并后由 GitHub 自动清理临时分支。

### 多平台打包与更新

- 维护者在 `custom` 上手动运行 `Desktop Release`，构建 Windows x64、Linux x64 和 macOS Apple Silicon。PR、推送和定时任务不会触发打包。
- 使用本仓库的 Release、更新清单和独立 Tauri 更新签名。
- 全部目标和产物验证成功后公开 Release；失败时保留诊断，不公开不完整产物。
- 发布说明先列本次定制改动；官方基线有变化时才附上官方更新。

### 多设备凭据恢复

配套服务为 [cockpit-credential-sync-server](https://github.com/Mickls/cockpit-credential-sync-server)。桌面端默认关闭同步，需在 Codex 设置中配置服务器并配对。三个平台的实机验收仍待完成。

目标行为：

- 添加账号或重新授权成功后上传加密凭据，普通 Token 自动刷新不上传。
- 本地明确授权失败时，优先由健康在线设备协助，再尝试服务端密文备份。
- 使用端到端加密，服务器不持有 OAuth 凭据解密密钥。
- 本轮恢复失败后停止，等待下次启动或手动同步，不循环重试。

## 上游功能与文档

Cockpit Tools 的账号切换、多实例、配额监控、API 服务及其他平台能力继承自官方项目。完整功能、安装说明、截图和上游致谢参见 [官方 README](https://github.com/jlcodes99/cockpit-tools/blob/main/README.md)。

本仓库文档：

- [上游同步与分支维护](docs/upstream-maintenance.md)
- [构建与发布](docs/custom-release.md)
- [定制方案和实施任务](openspec/changes/custom-cockpit-sync-and-release/proposal.md)

首次从官方版或旧 fork（含 `2.0.1270`）切换到新仓库时，请从本仓库 Release 手动覆盖安装；后续版本从新仓库自动检查更新。

## 开发

```bash
npm ci
npm run typecheck
npm run test:release
```

原生构建要求和平台依赖参见官方文档。凭据服务独立开发、部署，通过版本化协议与桌面客户端连接。

## 来源与许可证

上游作者与项目：[jlcodes99/cockpit-tools](https://github.com/jlcodes99/cockpit-tools)。感谢原作者及上游 README 中列出的贡献者和依赖项目。

保留资源中的第三方许可。项目沿用上游 [README](https://github.com/jlcodes99/cockpit-tools/blob/main/README.md) 声明的 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans)，定制分支不改变原有署名、非商业和相同方式共享要求；商业授权请联系上游作者。
