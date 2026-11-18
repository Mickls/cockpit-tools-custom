# 规格变更：定制版本打包

## Purpose

按需为三个受支持的平台生成桌面安装包，并使签名、更新清单与实际构建源码一致。

## ADDED Requirements

### Requirement: 手动触发三平台打包

发布流程 SHALL 只允许维护者在 `custom` 手动触发，目标为 Windows x64、Linux x64 和 macOS arm64。

#### Scenario: 多平台构建成功
- **WHEN** 维护者从 `custom` 手动触发
- **THEN** 流程 SHALL 针对准确提交构建三个指定目标，并分别报告结果

#### Scenario: 非手动事件
- **WHEN** 发生 PR、推送或定时事件
- **THEN** 流程 SHALL NOT 启动

#### Scenario: 某个平台失败
- **WHEN** 任一必需平台构建失败
- **THEN** 发布 SHALL 不被视为完成，并明确失败目标，不公开发布不完整版本

### Requirement: fork 自有签名与更新配置

发布包 SHALL 使用 fork 自有的签名凭据、更新地址、发布链接和生成的更新清单。

#### Scenario: 更新器检查 fork
- **WHEN** 已安装定制包检查更新
- **THEN** 更新器 SHALL 查询 fork 自有地址，并用 fork 公钥验证清单

#### Scenario: 缺少签名材料
- **WHEN** 发布任务缺少必需的 Tauri 更新签名凭据
- **THEN** 任务 SHALL 在发布产物前失败，且 SHALL 不在日志中暴露凭据值

### Requirement: 源码与产物完整性

每份发布产物 SHALL 可追溯到生成它的准确 `custom` 提交和上游基线。

#### Scenario: 查看产物来源
- **WHEN** 审阅者查看发布元数据
- **THEN** 元数据 SHALL 标明定制提交、上游版本或提交、目标平台和产物校验和

### Requirement: 发布完整性门槛

仅当全部必需平台构建、签名、清单及完整性检查成功后，流程 SHALL 公开完整 Release；未完成验证时仅允许内部暂存，不得公开。

#### Scenario: 完整发布
- **WHEN** 全部目标构建与验证成功
- **THEN** 流程 SHALL 公开完整 Release，草稿仅作上传暂存

### Requirement: 升级保留定制功能与用户数据

定制升级 SHALL 保留本地账号、实例、配对密钥及 fork 更新源。发布版本 SHALL 为定制渠道内递增的三段数字。

#### Scenario: 已配对安装升级
- **WHEN** 已有定制安装升级到下一定制版本
- **THEN** 本地用户数据和配对密钥 SHALL 保持可用，更新检查 SHALL 继续使用 fork

#### Scenario: 发布不完整
- **WHEN** 任一产物、签名、清单或验证步骤失败
- **THEN** 流程 SHALL 保留诊断，且 SHALL 不将该发布标记为公开完成

### Requirement: 定制版本打包不依赖 Apple 签名

定制版本构建 SHALL 不要求 Apple Developer ID 证书或公证凭据；安装包 SHALL 保留 Tauri 更新签名，并不得声称已通过 Apple 签名或公证。

#### Scenario: 无 Apple 证书仍可构建
- **WHEN** 定制版本工作流未配置任何 Apple 签名或公证密钥
- **THEN** macOS 打包 SHALL 正常进行，只以 Tauri 更新签名和产物验证作为发布必需门槛
