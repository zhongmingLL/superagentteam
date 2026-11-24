---
title: "F033 Phase B execution plan — runtime worktree, managed state, fixed ports"
doc_kind: plan
status: active
created: 2026-11-25
updated: 2026-11-25
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: [砚砚 (GLM 5.3 Flash), 墨墨 (Qwen 3.8 Flash)]
feature: F033
related_features: [superagentteam/F018, superagentteam/F032]
related: [features/F033-runtime-startup-worktrees.md, plans/0038-f033-runtime-startup-worktrees.md]
source_decision: "operator 2026-11-25: DP-F033-1=A, DP-F033-2=A, DP-F033-3=defer, DP-F033-4=A"
---

# F033 Phase B — 执行计划

## 已拍板

- `DP-F033-1=A`：进入 Phase B。
- `DP-F033-2=A`：runtime worktree = repo sibling `superagentteam-runtime`；runtime `3005/3014` + Windows `3103`；test `3007/3016`。
- `DP-F033-3=defer`：不做常驻 supervisor，也不上 Windows Task Scheduler；入口启动 detached 进程，并写可核验的 managed state。cron 只作迁移期兜底，验收后退役。
- `DP-F033-4=A`：旧 stack 先快照 data dir，再收尾旧进程，只留 `3103` 对应的一套；不删数据。

## 范围

### B1 — managed runtime state + 统一入口

- `<data-dir>/runtime-state.json`：worktree、HEAD、data dir、web/daemon 端口、hubOrigin、daemon bootId、进程 identity、startedAt、state。
- `superagentteam runtime start|status|end|restart`。
- 进程 identity 复用 lifecycle 的 `/proc` provider；`end` 只操作 identity-verified 进程，不按端口盲杀。
- env：默认 `~/.config/superagentteam/runtime.env`（0600）；`accounts.json` 要求的 env 缺失时 fail closed，不启动“页面能开但 agent 跑不动”的 stack。
- 固定端口 preflight：端口被非本 stack 占用时 typed 失败，并给出占用者提示。

### B2 — runtime worktree

- 默认 sibling `superagentteam-runtime`；`runtime start --worktree` 可覆盖。
- `--sync` 执行 ff-only 到已合入的默认开发分支；runtime worktree 不接受手工代码改动。
- 构建缺失时提示显式 `npm run build:offline`，不在入口里静默跑长构建。

### B3 — Windows 入口

- `runtime status` 校验 WSL web 端口监听与 Windows `3103` 映射，给出 `windowsProxy: configured | unverified`。
- 生成/重写 PowerShell proxy 留到 Phase C/D；DP-3 已 defer，Phase B 不引入跨 OS 复杂度。

### B4 — 验收与迁移

- 隔离端口 `3008/3017` + 临时 data dir 做 start/status/end/restart 集成验证。
- 切真实 `3005/3014`，验证 session 结束后存活、3103 bridge 可达。
- 旧栈 data dir 快照到 `~/superagentteam-archive/<timestamp>/`，再收尾旧进程；保留 `3103`。
- 现有 cron watchdog 改为调用统一入口或退役；记录证据与残余 gap。

## 进展（2026-11-25）

- **B1 已合入**：PR #188 → `e1ceb0e43`；砚砚（identity/端口/env/state）+ 墨墨（operator 文案/迁移）双审，CI `build-check-test` / `supply-chain` / `mcp-conformance` 全绿。
- **B2 完成**：runtime worktree `/home/ming/agent/superagentteam-runtime` at `e1ceb0e43`；`npm install --ignore-scripts` + `build:offline` 绿。
- **B3 部分**：Windows `3103` 实测 root/session 200；proxy 生成脚本仍延后。
- **B4 主体完成**：真实 `3005/3014` 切换到新入口，daemon `runningRevision=e1ceb0e43`；旧栈 data dir 快照到 `/home/ming/superagentteam-archive/20261124T173508Z/` 后收尾；cron watchdog 改为调用统一入口。
- **验证**：隔离 `3008/3017` start → status → restart → end，restart 后 PIDs/bootId 更新、end 后端口释放；真实 `3005/3014` health/web/API 200；`http://localhost:3103/` 与 `/api/session` 200。
- **残余**：Windows `3100/3101` proxy 清理、Windows proxy 生成、test worktree/CI drift guard、runbook、cron 退役（Phase C/D）。

## 验收映射

- AC-2 入口/状态/收尾/重启幂等，收尾 identity-verified：B1 单测 + B4 集成。
- AC-3 runtime 固定端口；test 独立端口：B1 preflight + B4。
- AC-4 session 结束后存活：B4（无 supervisor，仅 detached 进程）。
- AC-6 旧 stack 可列出/收尾/回收：B4。
- AC-7 Windows proxy：B3 校验；生成延后并具名记录 gap。
- AC-1/AC-5/AC-8：Phase C/D。

## 验证

- targeted：`NODE_ENV=development npm --prefix packages/superagentteam-daemon test -- runtime`。
- integration：隔离端口 start → status `running` → end → 端口释放；重复 start 幂等。
- real：`3005/3014` health + web 200 + `/api/session`；Windows `3103` bridge 检查。
- merge 前：`NODE_ENV=development npm run build:offline` + `npm run check`。

## 风险与 unknown

- 从 agent exec session 启动的 detached 进程仍可能被 cgroup 回收；入口预期由 operator 终端或外部调度运行。若 B4 无法稳定存活，重开 `DP-F033-3`。
- 当前 `KIMI_API_KEY` 只存在于旧 daemon 的进程 env；迁移到 0600 `runtime.env`，不打印值，不写入仓库。
- Windows proxy 生成延后：B3 只校验；Phase C/D 补生成与真机验收。

[宪宪/deepseek-flash🐾]
