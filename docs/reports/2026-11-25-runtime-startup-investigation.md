---
title: "Runtime startup investigation — current stacks vs Clowder AI"
doc_kind: report
status: draft
created: 2026-11-25
updated: 2026-11-25
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
related_features: [superagentteam/F033, superagentteam/F032]
---

# Runtime startup investigation

## 1. 当前本机 stack 盘点

| 角色 | WSL 前端 | WSL daemon | data dir | Windows 入口 | 备注 |
|---|---:|---:|---|---:|---|
| F025 e2e | 3000 | 3011 | `/tmp/f025-e2e-1795345602/data` | 3100 | 早期 e2e |
| devlogin | 3001 | 3012 | `/tmp/f025-e2e-devlogin/data` | 3101 | dev auto-login 验证 |
| F028 demo | 3005 | 3014 | `/tmp/f028-demo-1795448211/data` | 3103 | 当前 operator 入口 |
| F030 demo | 3006 | 3015 | `/tmp/f030-demo-1795493398/data` | — | 展示栈；HUB_ORIGIN=3104，无 proxy |
| F030 e2e | 3007 | 3016 | `/tmp/f030-e2e-1795493745/data` | — | e2e 栈；HUB_ORIGIN=3105，无 proxy |

另：`3004` 是 Clowder AI API，不属于 SuperAgentTeam。

当前实际 Windows listener 只有 `3100/3101/3103` 三个 PowerShell TCP proxy；每个 proxy 硬编码一个 WSL bridge 脚本，例如 `3103` → `wsl.exe python3 /tmp/f025-tcp-bridge-3005.py` → WSL `3005`。`3104/3105` 只是 F030 daemon 的 HUB_ORIGIN 配置，不是 Windows proxy。

## 2. 根因

1. **进程归属不稳**：多数 stack 的 daemon/Vite 由 cat-cafe exec session 启动；session 结束后进程被回收，Windows proxy 还在，表现为空响应。
2. **没有单一入口**：没有统一的入口/状态/收尾命令；只能临时加 cron watchdog，旧 stack 没有 owner/回收。
3. **worktree 角色缺失**：runtime、test/acceptance、dev 共用 `codeteam-e2e-full`，只靠 `SUPERAGENTTEAM_E2E_*` 区分 data dir/端口。
4. **端口无 registry**：端口靠人工挑，Windows proxy 硬编码，CI 没有 drift/conflict guard。
5. **window/bridge 分散**：PowerShell proxy、WSL bridge、cron watchdog 都是临时脚本，没有生成/校验契约。

## 3. Clowder AI 参考

| 机制 | 文件 | 可借鉴点 |
|---|---|---|
| 统一入口 | `docs/configuration/startup.md` | 一个命令完成 runtime worktree、服务、固定 URL；`quick/memory/daemon/direct/status` 模式 |
| runtime worktree | `scripts/runtime-worktree.sh` | sibling runtime 目录、ff-only 冻结 target SHA、identity-verified lifecycle |
| alpha/test worktree | `scripts/alpha-worktree.sh` | 独立目录、固定端口段、隔离数据 |
| port 派生/guard | `scripts/derive-worktree-ports.mjs`、`scripts/check-worktree-port-offset.mjs` | offset 规则、保留端口、CI 冲突检查 |
| worktree lifecycle | `scripts/worktree-new.mjs` | owner、policy、容量门禁、回收 |
| 跨平台入口 | `scripts/start-entry.mjs` | Unix/PowerShell 分发 |

## 4. F033 建议 contract

- runtime worktree：repo sibling 的 `superagentteam-runtime`；只消费 ff-only 已合入代码。
- test/acceptance worktree：repo sibling 的 `superagentteam-alpha`；独立 data dir/端口段。
- managed runtime state：worktree、HEAD、data dir、前端/daemon 端口、Windows 入口、bootId、进程身份、supervisor 身份。
- port registry：runtime/test 端口段 + Windows 映射 + 保留端口；启动前 preflight，CI guard。
- supervisor：优先 systemd user / Windows Task Scheduler；不可用时明确降级路径；cron 仅临时兜底。
- Windows proxy：生成/校验脚本，固定 bridge 目标，入口健康检查覆盖 proxy。
- 旧 stack：按 owner/data dir 列出；保留 `3103` 对应数据，其余按 operator 决定回收。

## 5. 待 operator 确认

1. runtime worktree 默认位置：repo sibling 还是用户 home 下的独立 root？
2. test/acceptance 端口段固定还是 worktree offset 派生？
3. supervisor 首选 systemd user、Windows Task Scheduler，还是受控 detached supervisor？
4. 旧 5 套 stack：保留数据后收尾，还是只保留 3103 对应的一套？

[宪宪/deepseek-flash🐾]
