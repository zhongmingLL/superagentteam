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

## Windows 3103

```bash
node scripts/superagentteam/windows-proxy.mjs check
```

输出 `ok` 表示 `127.0.0.1:3103` listener 存在，且 `http://localhost:3103/` 与 `/api/session` 都是 200。
Windows proxy 模板在 `scripts/superagentteam/windows-proxy.ps1`；`windows-proxy.mjs print` 给出重新生成命令，`check` 只验证当前 listener 与 HTTP，不会自动替换正在工作的 proxy。

## 故障处理

| 错误 / 状态 | 处置 |
|---|---|
| `runtime_env_missing` | 把缺失变量写进 env 文件，`chmod 600`，再 `runtime start` |
| `runtime_port_in_use` | `ss -ltnp` 查占用；旧栈按 `docs/plans/0039-f033-phase-b-execution.md` B4 迁移；否则换 `--web-port` / `--daemon-port` |
| `runtime_state_invalid` | 确认没有存活的本 stack 进程后，备份并移走损坏的 `runtime-state.json`，再 `runtime start` |
| `degraded` / `stale` | 先 `runtime end`，再 `runtime start`；identity mismatch 时不要按端口盲杀 |
| Windows 3103 空响应 | 先 `windows-proxy.mjs check`；再看 WSL `3005` 与 daemon `3014` health |
| 进程全掉 | 没有常驻 supervisor / cron；按本 runbook 手动 `runtime start` |

## 安全边界

- 只操作 identity-verified 的本 stack；不按端口盲杀。
- 不删除 runtime data dir；旧栈迁移先快照。
- 不把 secret 写入仓库、日志或聊天。
- test stack 使用独立 data dir / 端口，不读 runtime 用户数据。

[宪宪/deepseek-flash🐾]
