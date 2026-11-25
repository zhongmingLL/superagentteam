---
title: "F033 local runtime runbook"
doc_kind: runbook
status: active
created: 2026-11-25
updated: 2026-11-25
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
related_features: [superagentteam/F033]
---

# F033 本地运行 runbook

## 正式入口

正式入口是 CLI，不是直接运行某个 `scripts/*` 文件：

```bash
superagentteam runtime <start|status|end|restart>
```

二进制位置：`packages/superagentteam-daemon/dist/cli.js`（安装后为 `superagentteam`）。
脚本分层：SuperAgentTeam 运行面脚本在 `scripts/superagentteam/`；`scripts/` 根保留 upstream pi / release / check 工具。

## 当前布局

| 角色 | worktree | WSL 端口 | Windows | data dir | env |
|---|---|---|---|---|---|
| runtime | `/home/ming/agent/superagentteam-runtime` | `3005` / `3014` | `3103` | `/home/ming/.superagentteam-runtime/data` | `~/.config/superagentteam/runtime.env` |
| test | `/home/ming/agent/superagentteam-alpha` | `3007` / `3016` | 无 | `~/.superagentteam-alpha/data` | `~/.config/superagentteam/alpha.env` |

> 2026-11-25: runtime 数据已从旧 F028 demo 的 `/tmp/f028-demo-1795448211/data` 迁到持久路径 `~/.superagentteam-runtime/data`；旧目录保留为退役快照，不再作为运行数据。

`3003/3004` 属 Clowder AI，不在本 runbook 管理范围。

## 启动 runtime

```bash
cd /home/ming/agent/superagentteam-runtime
node packages/superagentteam-daemon/dist/cli.js \
  --data-dir /home/ming/.superagentteam-runtime/data \
  runtime start \
  --worktree /home/ming/agent/superagentteam-runtime \
  --hub-origin http://localhost:3005 \
  --env-file /home/ming/.config/superagentteam/runtime.env
```

入口会做端口 preflight、拉起 daemon + Vite、等 health，并写 `<data-dir>/runtime-state.json`。启动是幂等的：已 running 时返回 `already running`。

## 状态 / 收尾 / 重启

```bash
node packages/superagentteam-daemon/dist/cli.js --data-dir /home/ming/.superagentteam-runtime/data runtime status
node packages/superagentteam-daemon/dist/cli.js --data-dir /home/ming/.superagentteam-runtime/data runtime end
node packages/superagentteam-daemon/dist/cli.js --data-dir /home/ming/.superagentteam-runtime/data runtime restart --worktree /home/ming/agent/superagentteam-runtime --env-file /home/ming/.config/superagentteam/runtime.env
```

`status` 六态：`not_started` / `running` / `degraded` / `stale` / `stopped` / `failed`。
`end` 只对 `pid + startedAt + command` 匹配的进程发 SIGTERM；身份不匹配会拒绝并报 `degraded`，不会按端口盲杀。

## 更新 runtime worktree

runtime worktree 只消费已合入代码，不手工改：

```bash
cd /home/ming/agent/superagentteam-runtime
git fetch origin
git merge --ff-only origin/superagentteam-work
NODE_ENV=development npm run build:offline
```

更新后按上面的 `runtime restart` 重启；先 `status` 确认旧进程 identity，再重启。

## env 文件

- 默认：`/home/ming/.config/superagentteam/runtime.env`，权限 `0600`。
- 必需的变量来自 `<data-dir>/accounts.json`：`ENV:<NAME>` 取 `<NAME>`，legacy bare env name 保持；`secret:<ref>` 使用 stored credential，不需要 env。
- `runtime start` 在 spawn 前 fail closed：缺 env 会报 `runtime_env_missing`，不会启动“页面能开但 agent 跑不动”的 stack。
- 不要把 key 写进仓库或聊天；`accounts.json` 只存 `apiKeyRef`。

## test/acceptance stack

```bash
cd /home/ming/agent/superagentteam-alpha
node packages/superagentteam-daemon/dist/cli.js \
  --data-dir /home/ming/.superagentteam-alpha/data \
  runtime start --worktree /home/ming/agent/superagentteam-alpha \
  --web-port 3007 --daemon-port 3016 \
  --hub-origin http://localhost:3105 \
  --env-file /home/ming/.config/superagentteam/alpha.env
```

test stack 不读写 runtime 的 data dir，也不占用 `3005/3014/3103`。

## Windows 访问（3005 主路径，3103 legacy）

Windows 直接用 <http://localhost:3005>（WSL2 localhost forwarding；2026-11-25 实测 200）。
**3103 PowerShell proxy 不再默认使用**：它只是 F033 早期的兼容路径，且必须从 Windows 端启动——
从 WSL 里拉起的 PowerShell 再调 `wsl.exe` 会报 `Wsl/Service/E_UNEXPECTED`。仅当本机 localhost
forwarding 不可用时才按 `node scripts/superagentteam/windows-proxy.mjs print` 的输出在 Windows 端启动。
`runtime-state.json` 里的 `windowsPort: 3103` 只是元数据，不代表 proxy 在运行。

```bash
# 仅 legacy 排查时使用
node scripts/superagentteam/windows-proxy.mjs check
```

## 故障处理

| 错误 / 状态 | 处置 |
|---|---|
| `runtime_env_missing` | 把缺失变量写进 env 文件，`chmod 600`，再 `runtime start` |
| `runtime_port_in_use` | `ss -ltnp` 查占用；旧栈按 `docs/plans/0039-f033-phase-b-execution.md` B4 迁移；否则换 `--web-port` / `--daemon-port` |
| `runtime_state_invalid` | 确认没有存活的本 stack 进程后，备份并移走损坏的 `runtime-state.json`，再 `runtime start` |
| `degraded` / `stale` | 先 `runtime end`，再 `runtime start`；identity mismatch 时不要按端口盲杀 |
| Windows 打不开 localhost:3005 | 先看 WSL `3005` 与 daemon `3014` health；确认 WSL2 localhost forwarding；不要先怀疑 3103 proxy |
| 进程全掉 | 已装 WSL cron supervisor（`@reboot` + 每 2 分钟仅对 stale/degraded/failed 重启）；若未自愈，手动 `runtime start` 并 `crontab -l` 检查 |

## 安全边界

- 只操作 identity-verified 的本 stack；不按端口盲杀。
- 不删除 runtime data dir；旧栈迁移先快照。
- 不把 secret 写入仓库、日志或聊天。
- test stack 使用独立 data dir / 端口，不读 runtime 用户数据。

[宪宪/deepseek-flash🐾]
