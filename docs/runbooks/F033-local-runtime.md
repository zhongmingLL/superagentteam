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

| 角色 | worktree | 端口（web / daemon） | data dir | env |
|---|---|---|---|
| runtime | `/home/ming/agent/superagentteam-runtime` | `3005` / `3014` | `/home/ming/.superagentteam-runtime/data` | `~/.config/superagentteam/runtime.env` |
| test | `/home/ming/agent/superagentteam-alpha` | `3007` / `3016` | `~/.superagentteam-alpha/data` | `~/.config/superagentteam/alpha.env` |

> 2026-11-25: runtime 数据已从旧 F028 demo 的 `/tmp/f028-demo-1795448211/data` 迁到持久路径 `~/.superagentteam-runtime/data`；旧目录保留为退役快照，不再作为运行数据。

`3003/3004` 属 Clowder AI，不在本 runbook 管理范围。
Windows 直接用 `http://localhost:3005`；没有 Windows 代理。`3103` 是 F033 早期的迁移路径，
已从 runtime-state、port registry 和正式入口中移除。

## 启动 runtime

```bash
cd /home/ming/agent/superagentteam-runtime
node packages/superagentteam-daemon/dist/cli.js \
  --data-dir /home/ming/.superagentteam-runtime/data \
  runtime start \
  --worktree /home/ming/agent/superagentteam-runtime \
  --env-file /home/ming/.config/superagentteam/runtime.env
```

入口会做端口 preflight、拉起 daemon + Vite、等 health，并写 `<data-dir>/runtime-state.json`。启动是幂等的：已 running 时返回 `already running`。

> **hubOrigin 由 `--web-port` 推导。** 默认是 `http://localhost:<web-port>`；daemon 还接受同一
> 协议/端口下的 loopback 别名（`localhost` / `127.0.0.1` / `[::1]`）。只有自定义入口
> （例如 LAN origin）才显式传 `--hub-origin`；非 loopback Origin 必须与它完全一致。

## 状态 / 收尾 / 重启

```bash
node packages/superagentteam-daemon/dist/cli.js --data-dir /home/ming/.superagentteam-runtime/data runtime status
node packages/superagentteam-daemon/dist/cli.js --data-dir /home/ming/.superagentteam-runtime/data runtime status --check-write
node packages/superagentteam-daemon/dist/cli.js --data-dir /home/ming/.superagentteam-runtime/data runtime end
node packages/superagentteam-daemon/dist/cli.js --data-dir /home/ming/.superagentteam-runtime/data runtime restart --worktree /home/ming/agent/superagentteam-runtime --env-file /home/ming/.config/superagentteam/runtime.env
```

`status` 六态：`not_started` / `running` / `degraded` / `stale` / `stopped` / `failed`。
`status` 会打印 `public` 与 `origins`；`--check-write` 再做一次安全的写路径 smoke
（本地 session + 带 Origin 的无效 agent POST，期望 400/422），403/401 会返回非零。
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
  --env-file /home/ming/.config/superagentteam/alpha.env
```

test stack 不读写 runtime 的 data dir，也不占用 `3005/3014`；hubOrigin 自动跟随其 `--web-port`（3007）。

## Windows 访问

Windows 直接用 <http://localhost:3005>（WSL2 localhost forwarding，2026-11-25 实测 200）。
**没有 Windows 代理，也不需要启动 3103。** 历史 PowerShell proxy 脚本仍在 `scripts/superagentteam/`
下，但已不参与正式入口、runtime-state 或 port registry。

## cron supervisor

WSL cron 负责崩溃恢复：`@reboot` + 每 2 分钟只在 `stale/degraded/failed` 时重启；
`stopped` 不会自动拉起。cron 只传 `--web-port 3005 --daemon-port 3014 --env-file ...`；
hubOrigin 由 web-port 推导，不再单独配置。

## 故障处理

| 错误 / 状态 | 处置 |
|---|---|
| `runtime_env_missing` | 把缺失变量写进 env 文件，`chmod 600`，再 `runtime start` |
| `runtime_port_in_use` | `ss -ltnp` 查占用；旧栈按 `docs/plans/0039-f033-phase-b-execution.md` B4 迁移；否则换 `--web-port` / `--daemon-port` |
| `runtime_state_invalid` | 确认没有存活的本 stack 进程后，备份并移走损坏的 `runtime-state.json`，再 `runtime start` |
| `degraded` / `stale` | 先 `runtime end`，再 `runtime start`；identity mismatch 时不要按端口盲杀 |
| Windows 打不开 localhost:3005 | 先看 WSL `3005` 与 daemon `3014` health；确认 WSL2 localhost forwarding |
| `runtime status --check-write` 报 403 `origin not allowed` | `hubOrigin` 与浏览器入口不一致（非 loopback 或端口不同）；用 `--hub-origin http://localhost:3005` 覆盖后重启 |
| 进程全掉 | 已装 WSL cron supervisor（`@reboot` + 每 2 分钟仅对 stale/degraded/failed 重启）；若未自愈，手动 `runtime start` 并 `crontab -l` 检查 |

## 安全边界

- 只操作 identity-verified 的本 stack；不按端口盲杀。
- 不删除 runtime data dir；旧栈迁移先快照。
- 不把 secret 写入仓库、日志或聊天。
- test stack 使用独立 data dir / 端口，不读 runtime 用户数据。

[宪宪/deepseek-flash🐾]
