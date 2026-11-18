# Cockpit Tools

基于 [jlcodes99/cockpit-tools](https://github.com/jlcodes99/cockpit-tools) 的定制分支，围绕多设备 Codex 账号管理、凭据恢复和持续跟进官方更新扩展。

[下载 Release](https://github.com/Mickls/cockpit-tools/releases) · [官方仓库](https://github.com/jlcodes99/cockpit-tools) · [官方 README](https://github.com/jlcodes99/cockpit-tools/blob/main/README.md) · [凭据同步服务](https://github.com/Mickls/cockpit-credential-sync-server)

## 定制功能

### 持续跟进官方更新

- 长期保留 `main` 和 `custom` 两个分支：`main` 跟进官方，`custom` 集成定制功能。
- 定期检查官方正式版本；没有更新时不创建无效分支、PR 或合并。
- 更新通过临时 PR 集成，通过检查后合并，合并后自动清理临时分支。

### 多平台打包与更新

- 每次合并到 `custom` 后，构建 macOS Apple Silicon、Intel、Universal，Windows x64，以及 Linux x64 / arm64。
- 使用本仓库的 Release、更新清单和独立 Tauri 更新签名。
- 全部目标和产物验证成功后公开 Release；失败时保留诊断，不公开不完整产物。
- 有定制更新时以定制说明为主；没有定制更新时沿用对应官方版本说明。

### 多设备凭据恢复（开发中）

配套服务为 [cockpit-credential-sync-server](https://github.com/Mickls/cockpit-credential-sync-server)。服务端已包含加密载荷、设备鉴权、配对与备份基础，桌面端的完整接入仍在 [PR #3](https://github.com/Mickls/cockpit-tools/pull/3) 开发，当前发布包尚不提供完整恢复流程。

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

首次从官方版切换到本分支时，请从本仓库 Release 手动安装；后续更新使用本仓库的签名和更新源。

## 开发

```bash
npm ci
npm run typecheck
npm run test:release
```

原生构建要求和平台依赖参见官方文档。凭据服务独立开发、部署，通过版本化协议与桌面客户端连接。

## 来源与许可证

上游作者与项目：[jlcodes99/cockpit-tools](https://github.com/jlcodes99/cockpit-tools)。感谢原作者及上游 README 中列出的贡献者和依赖项目。

保留上游 [LICENSE](LICENSE) 及资源中的第三方许可。项目采用上游的 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans)，定制分支不改变原有署名、非商业和相同方式共享要求；商业授权请联系上游作者。
