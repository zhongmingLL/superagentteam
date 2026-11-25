---
feature_ids: [superagentteam/F033]
related_features: [superagentteam/F018, superagentteam/F032]
title: "F033: Local runtime startup & worktree isolation"
status: done
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

## 进展

> 2026-11-25（operator）：Windows 访问改为 `http://localhost:3005`（WSL2 localhost forwarding 实测可用）；3103 PowerShell proxy 降为 legacy/可选，必须从 Windows 端启动。runtime 仍保持 `windowsPort: 3103` 元数据，但不再依赖 proxy。

> 2026-11-25（live fix）：cron 曾把 `--hub-origin` 固定为 3103，导致 3005 页面的写请求被判
> `origin not allowed` 403；已把 cron/live 改为 3005，并让 CLI 默认 hub origin 跟随
> `--web-port`。3103 仍只作为 legacy PowerShell proxy 的元数据。

> 2026-11-25（follow-up）：daemon 的 origin allowlist 接受同一协议/端口下的 loopback 别名
> （`localhost` / `127.0.0.1` / `[::1]`），避免 operator 用 `127.0.0.1:3005` 打开页面后
> 写请求被 403；非 loopback origin 仍要求精确匹配。

> 2026-11-25（single-entry cleanup）：runtime-state 与 port registry 移除 `windowsPort`/3103；
> hubOrigin 只由 `--web-port` 推导；`runtime status` 打印 `public`/`origins`，`--check-write`
> 做带 Origin 的写路径 smoke。cron 不再传 `--hub-origin`/`--windows-port`。

### 2026-11-25 — Phase B 运行面迁移

- B1 统一入口已合入：PR #188 → `e1ceb0e43`；reviewers 砚砚（identity/端口/env/state）+ 墨墨（operator 文案/迁移），CI `build-check-test` / `supply-chain` / `mcp-conformance` 全绿。
- runtime worktree：`/home/ming/agent/superagentteam-runtime`，detached at `e1ceb0e43`。
- 真实入口：`3005/3014` + Windows `3103`；daemon `runningRevision=e1ceb0e43`，health ready，`/`、`/api/session`、`/api/agents`、`/api/threads` 与 `http://localhost:3103/` 均 200；数据目录当时沿用 `/tmp/f028-demo-1795448211/data`；Phase D 已迁到 `~/.superagentteam-runtime/data`。
- env：`~/.config/superagentteam/runtime.env`（0600），从旧 daemon 进程 env 迁移 `KIMI_API_KEY`，未打印、未入库。
- 旧栈：4 套 data dir 快照到 `/home/ming/superagentteam-archive/20261124T173508Z/`；旧 WSL 栈已收尾，仅保留 `3005/3014`（另 `3003/3004` 属 Clowder AI）。
- cron watchdog：改为调用统一入口，作为迁移期兜底；稳定观察后退役（Phase D）。
- 已补隔离 `3008/3017` 的 start/status/end/restart 集成验证；restart 后进程与 bootId 均更新，end 后端口释放。
- 残余 gap：Windows `3100/3101` proxy 仍未移除；Windows proxy 生成脚本、test worktree、CI drift/conflict guard、runbook 留 Phase C/D。

### 2026-11-25 — Phase C test isolation & cleanup

- test worktree `/home/ming/agent/superagentteam-alpha` at `04b087379`；build 绿。
- test stack `3007/3016` + `~/.superagentteam-alpha/data` + `~/.config/superagentteam/alpha.env`；start/status/end 全绿，runtime `3103` 不受影响。
- port registry `scripts/superagentteam/runtime-ports.mjs` + `scripts/superagentteam/runtime-ports.test.mjs`；`check:runtime-ports` 已接入 `npm run check`，覆盖重复/保留端口/越界与 CLI 默认值漂移。
- 旧 Windows `3100/3101` proxy 经 identity 核验后停止；只剩当前 `3103`。

### 2026-11-25 — Phase D script layout & runbook

- runtime launcher 迁到 `scripts/superagentteam/runtime-daemon.mjs`；`scripts/f025-e2e-daemon.mjs` 保留兼容 wrapper；CLI 的 spawn/assertBuilt 指向新路径。
- port registry/test 迁到 `scripts/superagentteam/`；`check:runtime-ports` 指向新路径。
- runbook 落 `docs/runbooks/F033-local-runtime.md`：正式入口、runtime/test 布局、env、端口、Windows 3103、故障恢复。
- Windows proxy 模板 `scripts/superagentteam/windows-proxy.ps1` + WSL bridge `wsl-tcp-bridge.py` + `windows-proxy.mjs check|print`；3103 listener/root/session 实测通过。
- cron watchdog 已备份到 `/home/ming/superagentteam-archive/20261124T173508Z/cron/` 并退役；当前 runtime 无 cron 依赖，3103 仍 200。
- 墨墨 P2 收口：runtime 数据从 `/tmp/f028-demo-1795448211/data` 迁到 `~/.superagentteam-runtime/data`；旧目录快照到 `/home/ming/superagentteam-archive/20261124T173508Z/runtime-data-before-persistent-migration/`；新路径启动后 3103/`/api/session` 仍 200。
- live runtime worktree ff-only 到 `bac20a684`、rebuild、`runtime end`→`runtime start`；daemon command 已切到 `scripts/superagentteam/runtime-daemon.mjs`，数据仍在持久路径，3103/`/api/session` 200。
- alpha worktree 同步 `bac20a684`；test stack `3007/3016` start/status/end 闭环，端口释放，3103 不受影响。

## 验收方向

- [x] AC-1：默认入口从专用 runtime worktree 运行；dev worktree 不承担 runtime。
- [x] AC-2：入口/状态/收尾/重启幂等，收尾只操作 identity-verified stack，不盲杀端口。
- [x] AC-3：runtime 与 Windows 入口固定；test 使用独立端口段，CI 有 drift/conflict guard。
- [x] AC-4：进程在启动 session 结束后仍存活；无长期 cron watchdog 依赖。
- [x] AC-5：test/acceptance 使用独立 worktree、data dir、端口；不读写 runtime 用户数据。
- [x] AC-6：旧 stack 可列出/收尾/回收；启动后无孤儿端口。
- [x] AC-7：Windows proxy 由脚本生成/校验，入口只给一个 URL。
- [x] AC-8：runbook 覆盖运行、收尾、恢复、端口冲突、worktree 更新与回滚。

> 2026-11-25：AC-1–AC-8 已由 PR #188/#190、Phase C 隔离清理与 Phase D runbook/proxy/cron 退役验证；feature 实现完成，operator close pending。

## 收口

- 2026-11-25 operator close：F033 完成。
- live runtime：`bac20a684`，daemon `scripts/superagentteam/runtime-daemon.mjs`，data `~/.superagentteam-runtime/data`，`http://localhost:3103/` 与 `/api/session` 200。
- 所有 AC-1–AC-8 有证据；旧栈/旧 proxy 已快照并收尾。
- 2026-11-25 后续：WSL cron supervisor 重新启用（`@reboot` + 每 2 分钟仅对
  `stale/degraded/failed` 重启）；它是崩溃恢复兜底，不是进程存活依赖。live runtime
  跟随 `superagentteam-work`；入口与 hubOrigin 均为 3005，无 Windows 代理。

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
