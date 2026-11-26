# 规格变更：上游维护

## Purpose

使定制版 Cockpit Tools fork 能够持续同步官方项目，同时保持少量、清晰的长期分支。上游更新必须经过可复核的合并流程和明确验证，避免无更新时产生无效分支、PR 或合并，并在集成后清理临时分支。

## ADDED Requirements

### Requirement: 长期分支结构

fork SHALL 仅将 `main` 和 `custom` 保留为长期远端分支。已合并的功能或上游更新源分支 SHALL 自动删除，不得删除两个长期分支。

#### Scenario: 上游临时分支合并后清理
- **WHEN** 上游更新 PR 合并到 `custom`
- **THEN** 删除远端源分支，且不新增长期分支

#### Scenario: 功能分支合并
- **WHEN** 定制功能分支合并到 `custom`
- **THEN** 源分支 SHALL 自动删除；本地清理 SHALL 保留未合并工作

#### Scenario: 本地命名与目标分支不同
- **WHEN** 开发者在本地准备更新
- **THEN** 本地分支 MAY 使用 `codex/*` 命名，但远端合并目标仍为 `custom`

### Requirement: 无更新时不产生同步变更

维护流程 SHALL 每小时、推送到 `custom` 及手动触发时检查官方 `main`，在创建同步变更前比较其最新提交与本仓库 `main`、`custom`。定时同步 SHALL NOT 触发打包。

#### Scenario: 官方没有更新
- **WHEN** fork 的 `main` 已包含最新官方版本
- **THEN** 流程 SHALL 结束，不创建分支、PR 或合并

#### Scenario: 官方存在更新
- **WHEN** 官方仓库存在更新的已选定版本
- **THEN** 流程 SHALL 创建一个指向 `custom` 的临时同步变更

#### Scenario: 已有待集成更新
- **WHEN** `main` 已跟进某个官方更新，但该更新尚未集成到 `custom`
- **THEN** 流程 SHALL 保留或继续处理已有 PR，不得重复创建，也不得误认为更新已完成

#### Scenario: 已有同步 PR 包含人工修复
- **WHEN** 官方 main 又有新提交，而待处理同步分支包含无法快进保留的人工修复
- **THEN** 流程 SHALL 更新上游镜像并报告需人工合并，不强制覆盖同步分支、不创建重复 PR

### Requirement: 合并与验证门槛

上游同步变更 SHALL 在本地完成检查后合并；PR SHALL NOT 触发 Actions。

#### Scenario: 无冲突且检查通过
- **WHEN** 临时更新不存在冲突且全部必需检查通过
- **THEN** 更新 MAY 合并到 `custom`，随后删除临时分支
- **AND** 合并 SHALL 在 `custom` 祖先关系中保留上游提交

#### Scenario: 冲突或检查失败
- **WHEN** 合并存在冲突或必需检查失败
- **THEN** 更新 SHALL 保持可供人工处理，且 SHALL NOT 触发发布包生成

### Requirement: fork 自有更新元数据

维护流程 SHALL 将更新器和发布元数据指向 fork 的发布源，并保留定制构建与其上游版本的对应关系。

#### Scenario: 定制构建标明来源
- **WHEN** 从 `custom` 构建发布版本
- **THEN** 元数据 SHALL 包含上游版本或提交及定制修订号，更新链接 SHALL 指向 fork
