---
feature_ids: [superagentteam/F033]
related_features: [superagentteam/F018, superagentteam/F032]
title: "F033: Local runtime startup & worktree isolation"
status: spec
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: [砚砚 (GLM 5.3 Flash), 墨墨 (Qwen 3.8 Flash)]
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-25
updated: 2026-11-25
source_decision: "operator 2026-11-25: local startup is messy; borrow Clowder AI's startup script, runtime worktree, dedicated test worktree and deterministic ports"
---

# F033: Local runtime startup & worktree isolation

## Why

本机当前同时存在多套 SuperAgentTeam dev/demo stack，端口、数据目录和生命周期都不是单一真相源：

- 同一份 `codeteam-e2e-full` checkout 上先后出现过多套 stack，每套都有自己的 data dir 和端口。
- Windows 入口固定转发到某个 WSL 前端端口，但该端口对应的进程会随 cat-cafe exec session 结束被清理，浏览器表现为空响应。
- 没有统一的入口/状态/收尾命令；只能临时加 cron watchdog，旧 stack 没有 owner 和回收策略。
- 运行、测试/验收、开发共用同一 checkout，只靠环境变量区分，没有 runtime / test worktree 角色边界。
- 端口靠人工挑，Windows proxy 硬编码 WSL 端口，没有 registry 和 drift guard。

这不是单个脚本的 bug，而是缺少 local runtime 的 ownership contract：谁创建、跑在哪个 worktree、用哪些端口、谁负责收尾、失败如何恢复。F032 清掉 task-first runtime 后，正好把本地运行面收敛成一条。

## Clowder AI 参考（只读）

Clowder AI 的启动面已经把这些分清了，F033 借鉴机制而不复制实现：

- 统一入口 + `--quick` / `--memory` / `--daemon` / `direct` / `status` 模式。
- runtime worktree：独立的受管运行目录，ff-only 同步到已合入代码，生命周期命令只操作 identity-verified runtime。
- alpha/test worktree：隔离的验收目录，固定端口段和独立数据。
- 端口派生 + CI 检查：offset 规则、保留端口、冲突/漂移 guard。
- worktree lifecycle policy：owner、容量门禁、回收契约。
- 跨平台入口：Unix 脚本 / Windows PowerShell 分发。

## 用户结果

- 一个固定入口启动本地 runtime，默认从专用 runtime worktree 运行，不从开发/测试 worktree 运行。
- 入口/状态/收尾/重启幂等、typed、可恢复；进程不依赖 cat-cafe exec session 存活。
- runtime 使用固定端口和固定 Windows 入口；test/acceptance 使用独立端口段与数据目录。
- 启动后只给一个可访问 URL；Windows proxy 由脚本生成/校验，不再手写临时 bridge 或 cron。
- 旧 stack 可被列出并按 owner/策略回收；不再出现“不知道哪个端口是哪套”的状态。

## 目标形态

### 1. Worktree 角色

| 角色 | 默认位置 | 用途 | 数据 |
|---|---|---|---|
| runtime | repo sibling 的 `superagentteam-runtime` | 日常本地运行；只消费 ff-only 已合入代码 | 显式 `$SUPERAGENTTEAM_DATA_DIR`，与 dev/test 隔离 |
| dev | 当前 feature worktree | 改代码、跑 targeted tests | 临时 data dir |
| test/acceptance | repo sibling 的 `superagentteam-alpha` | 隔离验收、E2E、迁移验证 | 独立 test data dir |

规则：runtime worktree 不手工改代码；dev/test worktree 不占用 runtime 端口和数据。

### 2. 统一入口

- `superagentteam` 提供环境入口、状态、收尾、重启，以及 `quick` / `direct` / `daemon` 模式。
- 入口解析 runtime worktree、ff-only 同步、按需 build、等待 daemon health 和 web proxy，再打印唯一 URL。
- 收尾只操作 identity-verified 的本 stack，不按端口盲杀。

### 3. 端口与 Windows 入口

- runtime 前端/daemon 与 Windows 入口固定，写入 registry；test 使用独立端口段。
- 启动前做 owner/port preflight；CI 加 drift/conflict guard。
- Windows proxy 生成/校验脚本，固定 bridge 目标；入口健康检查覆盖 proxy。

### 4. 进程生命周期

- 优先使用系统可用的 supervisor（systemd user / Windows Task Scheduler / 兼容的 detached supervisor）；没有时明确降级路径。
- 不使用 cron watchdog 作为长期主路径；cron 只能作为临时兜底并标注退役条件。
- 进程身份、bootId、data dir、端口写入 managed runtime state；状态/收尾只认这个 state。

## 分阶段

| Phase | 范围 | 出口 |
|---|---|---|
| A | 调研 + contract/design：worktree 角色、端口 registry、state 文件、supervisor 方案、Windows proxy 契约、旧 stack 迁移/清理 | F033 contract + operator 确认边界 |
| B | runtime worktree + 统一入口/状态/收尾 + 固定端口 + Windows proxy + 单 URL | 一台机器上一键运行，session 结束后仍存活 |
| C | test/acceptance worktree + 数据/端口隔离 + 旧 stack 清理/回收 + CI drift guard | 运行/测试互不污染；无孤儿监听 |
| D | runbook + 迁移说明 + 移除临时 cron/bridge 脚本 + 验收 | operator 按 runbook 可独立运行/收尾/恢复 |

## 验收方向

- [ ] AC-1：默认入口从专用 runtime worktree 运行；dev worktree 不承担 runtime。
- [ ] AC-2：入口/状态/收尾/重启幂等，收尾只操作 identity-verified stack，不盲杀端口。
- [ ] AC-3：runtime 与 Windows 入口固定；test 使用独立端口段，CI 有 drift/conflict guard。
- [ ] AC-4：进程在启动 session 结束后仍存活；无长期 cron watchdog 依赖。
- [ ] AC-5：test/acceptance 使用独立 worktree、data dir、端口；不读写 runtime 用户数据。
- [ ] AC-6：旧 stack 可列出/收尾/回收；启动后无孤儿端口。
- [ ] AC-7：Windows proxy 由脚本生成/校验，入口只给一个 URL。
- [ ] AC-8：runbook 覆盖运行、收尾、恢复、端口冲突、worktree 更新与回滚。

## 非目标

- 不改变 A2A runtime / Hub API / 消息语义；F033 只做本地运行面。
- 不做生产部署/多机编排；生产部署仍走独立 release/acceptance 流程。
- 不把 runtime worktree 变成第二个开发分支；runtime 只消费已合入的默认开发分支代码。
- 不保留多套长期并行的 demo stack；历史 stack 只作为迁移输入。

## 依赖与风险

- 依赖 F032 已完成：本地只有 A2A v1 runtime，没有 legacy/control.db 双路径。
- 风险：WSL/Windows loopback 与端口转发行为不一致 → Phase A 必须先冻结 Windows proxy 契约并在真机验证。
- 风险：supervisor 选择受宿主环境限制 → contract 必须写清降级路径与可观测状态。
- 风险：runtime worktree 更新与本地数据迁移 → 先只消费 ff-only 已合入代码，数据迁移单独记录。

## 开放问题（Phase A 前确认）

- runtime worktree 默认位置用 repo sibling 还是用户 home 下的独立 root？
- test/acceptance 端口段固定，还是按 worktree offset 派生？
- 本机 supervisor 首选 systemd user、Windows Task Scheduler，还是受控的 detached supervisor？
- 旧 5 套 demo stack 是保留数据后收尾，还是只保留 Windows 入口对应的一套？

[宪宪/deepseek-flash🐾]
