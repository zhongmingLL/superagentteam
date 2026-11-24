---
title: "F033 execution plan — local runtime startup & worktree isolation"
doc_kind: plan
status: draft
created: 2026-11-25
updated: 2026-11-25
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: [砚砚 (GLM 5.3 Flash), 墨墨 (Qwen 3.8 Flash)]
feature: F033
related_features: [superagentteam/F018, superagentteam/F032]
related: [features/F033-runtime-startup-worktrees.md, architecture/0005-thread-first-runtime.md]
source_decision: "operator 2026-11-25: local startup is messy; borrow Clowder AI's startup/runtime-worktree/test-worktree approach"
---

# F033 execution plan

## Goal

把本地 SuperAgentTeam 运行面收敛成单一、可恢复、可验证的 runtime contract：一个受管 runtime worktree、一个隔离 test worktree、固定端口/Windows 入口、身份校验的生命周期命令和 runbook。

## Phase A — contract/design

1. 冻结 worktree 角色：
   - runtime worktree 的 sibling 路径/命名、同步来源、是否允许手工改动。
   - test/acceptance worktree 的 sibling 路径/命名、数据目录、端口段。
   - dev worktree 只做开发与 targeted tests，不承担 runtime。
2. 冻结 managed runtime state：
   - worktree、HEAD、data dir、前端/daemon 端口、Windows 入口、bootId、进程身份、supervisor 身份。
   - 状态/收尾只认该 state；stale state 有 typed recovery。
3. 冻结 port registry：
   - runtime 与 test 的端口段、Windows 入口映射、保留端口。
   - 启动前 preflight；CI drift/conflict guard。
4. 冻结 supervisor 方案：
   - 首选 systemd user 或 Windows Task Scheduler；不可用时写清降级路径。
   - 明确 cron watchdog 只是临时兜底及其退役条件。
5. 冻结 Windows proxy 契约：
   - 目标 WSL 端口、生成/校验脚本、健康探测、失败提示。
6. 迁移旧 stack：列出当前多套 stack 的 data dir/端口/owner，决定保留或回收。

出口：F033 contract + operator 确认边界；不在 Phase A 写产品代码。

## Phase B — runtime worktree + 统一入口

- 实现 runtime worktree 创建/复用/ff-only 同步。
- 实现统一环境入口、状态、收尾、重启、quick/direct/daemon 模式。
- 启动等待 daemon health + web proxy；失败回滚并保留可诊断状态。
- 固定 runtime 端口与 Windows 入口；生成/校验 proxy。
- 验收：session 结束后进程仍存活；状态与收尾幂等。

## Phase C — test/acceptance isolation

- 创建/复用 test worktree，独立 data dir 与端口段。
- 运行/测试互不污染；test 不读写 runtime 用户数据。
- 旧 stack 列表/回收；启动后无孤儿监听。
- CI 加 port drift/conflict guard 与 worktree role guard。

## Phase D — runbook + migration + cleanup

- 写 runbook：运行、状态、收尾、恢复、端口冲突、worktree 更新、回滚。
- 迁移说明：旧 stack/data dir/Windows proxy 的处置。
- 移除临时 cron/bridge 脚本；保留 archive/历史说明。
- 验收：operator 按 runbook 可独立运行、收尾、恢复。

## Verification

- targeted: worktree sync、state identity、port preflight、Windows proxy health。
- integration: 一键运行后 session 结束仍存活；重复入口幂等；test/runtime 数据隔离。
- full: build/check/test + A2A CLI/provider E2E；无孤儿端口。
- runbook dry-run：按文档从干净状态走到可访问 URL。

## Rollback

- Phase B/C 均为本地运行面，不迁移用户数据；回滚到当前 in-place 运行方式并把 managed state 标为 retired。
- runtime/test worktree 可保留或按 lifecycle policy 回收；不删除用户数据。
- Windows proxy 旧脚本保留到新入口验证通过后再移除。

## Review

- 砚砚：worktree/state identity、supervisor 安全边界、端口/Windows proxy、无盲杀。
- 墨墨：operator 可读的入口/状态/错误文案、runbook 可执行性、历史 stack 迁移说明。

[宪宪/deepseek-flash🐾]
