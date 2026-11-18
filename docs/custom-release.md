# 构建与发布

在 GitHub 的 **Actions → Desktop Release → Run workflow** 中选择 `custom`，或运行 `gh workflow run custom-release.yml --repo Mickls/cockpit-tools-custom --ref custom`。工作流先检查该提交是否已包含官方最新正式版，再生成 Windows x64、Linux x64、macOS arm64 安装包。推送只触发上游检查，发布仍由维护者手动触发。

## 签名策略

无需 Apple Developer ID 证书和公证；macOS 使用临时签名，不标称 Apple 签名或公证。Windows 不依赖代码签名证书。所有更新文件独立使用 Tauri 更新签名；最终汇总验证每份文件签名、公钥、来源提交和版本，缺失任一平台时不创建发布。

`TAURI_SIGNING_PRIVATE_KEY` 和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 存在仓库 Actions Secrets；私钥不能提交到 Git。当前本机备份在 `~/.config/cockpit-tools-release/`，权限限制为当前用户。应自行保管离线副本，丢失私钥会使已安装客户端无法信任新签名。

## 版本与发布

版本为 `2.0.N`，N 是受保护 `custom` 提交的 first-parent 提交数。不能强制改写 `custom` 历史。重跑相同 SHA 保留相同版本；仅在隔离构建工作区修改版本文件，不自动提交版本更新，避免循环构建。

全部平台、签名、来源、清单和校验和验证成功后自动公开 Release，包含更新清单、SHA256SUMS、按平台记录的来源元数据和安装包。失败时保留 Actions 诊断，不生成不完整 Release。草稿仅在上传期间作为内部暂存状态，验证完成后立即公开；更新器读取已公开的 fork Release。首次从官方版改用定制版需手动安装。

更新源为 `https://github.com/Mickls/cockpit-tools-custom/releases/latest/download/latest.json` 及目标平台清单。已安装的 `2.0.1270` 仍查询原 fork；首次迁移请从新仓库手动覆盖安装。旧工作流存放于 `.github/workflow-reference/`，不会执行。

实机验收分别检查：安装启动、账号及实例保留、升级后配对密钥保留、更新源持续指向 fork。CI 构建通过不代表这些真实设备验收已通过。

## 更新说明

定制发布说明维护在 `release-notes/custom/*.md`，每项变更新增独立文件。从上一次公开 Release 到当前提交有新增或修改的说明时，定制内容置于首位。只有首次发布或官方基线相对上一版发生变化时，才加入对应基线的官方更新；两类都有时，GitHub 发布页将官方更新折叠附后。官方基线不变时，客户端弹窗和发布页只显示本次定制改动。
