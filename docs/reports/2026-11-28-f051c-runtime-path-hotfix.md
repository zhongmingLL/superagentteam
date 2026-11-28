---
title: "F051c runtime path hotfix — BUG-F051-001"
doc_kind: report
status: active
created: 2026-11-28
updated: 2026-11-28
source_decision: "operator 2026-11-28: runtime 部署后 a2a-测试2 前端很卡、发送很慢、agent 启动失败；修根因并部署"
---

# F051c runtime path hotfix — BUG-F051-001

## 坐标

| 项 | 值 |
|---|---|
| worktree | `/home/ming/agent/codeteam-f037` |
| fix commit | `46f936e4b`（PR #264） |
| merge | `e1d1dd38b` |
| runtime | `/home/ming/agent/superagentteam-runtime` @ `e1d1dd38b`；web `3005` / daemon `3014` |
| runtime data | `/home/ming/.superagentteam-runtime/data`（只读诊断，不另造实验数据） |
| test | 隔离 `3007/3016` + `/home/ming/.superagentteam-f037-e2e/data` |

## BUG-F051-001（P1，Runtime）— F051a move 后 worker CLI 路径少退一层，所有 agent 启动失败

- **现象**：runtime 部署 `df2f1b978` 后，`a2a-测试2` 发送消息约 50s 才失败；前端持续卡顿。
  Hub 显示 5 条“回复失败”与“自动重试 5 次仍失败”。
- **复现**：在 runtime 3005 的 `a2a-测试2` 发给 `agentd-4eeb`（deepseek）；
  invocation 终态 `failed/provider_retry_exhausted`，5 条 attempts 的 `worker_id` 全空。
- **期望**：worker 正常 spawn，首次 attempt 完成并回复。
- **根因**：F051a 把 `daemon.ts` / `daemon-a2a.ts` 从 `src/` 移入 `src/app/`，但两处
  `import.meta` 相对路径仍按旧深度计算：
  - `resolvePiCliPath()` → `packages/superagentteam-daemon/coding-agent/dist/cli.js`
    （不存在）；worker spawn 在写 worker 行之前 ENOENT，所有 provider 回合都会失败。
  - `resolveWebDistPath()` → `packages/superagentteam-daemon/superagentteam-web/dist`
    （不存在）；是同一 move 的潜在静态服务回归。
- **修复**：两处各补一层 `..`；新增 `f051c-runtime-paths.test.ts`，按 packages 根锚定
  canonical 路径，不依赖“文件碰巧存在”。
- **修复 commit**：`46f936e4b`；merge `e1d1dd38b`；reviewer 砚砚 approve（exact HEAD
  `46f936e4b`，P1 事故、修法正确且完整）。
- **回归**：RED（2/2 fail）→ GREEN（2/2 pass）；daemon `561 passed / 5 skipped`；
  隔离 3007/3016 真实 Kimi 回合 `completed`，真实 `worker_id`，回复 `F051C_PATH_OK`。
- **状态**：fixed / deployed / verified（事故闭环）。

## 临时缓解与正式部署

1. 定位后先在 `runtime.env` 追加 `PI_CLI=<correct path>` 并重启，恢复线上；原 env
   备份为 `runtime.env.bak-f051c-20261128T092824`（0600）。
2. PR #264 合入后，runtime worktree ff 到 `e1d1dd38b`，`npm run build:offline` 通过。
3. 恢复 runtime.env 备份（移除 `PI_CLI`），重启；daemon 进程环境确认 `PI_CLI` 不存在。
4. `runtime status --check-write`：daemon/web alive+verified，write path ok；
   `/health` `runningRevision=e1d1dd38b`，bootSequence 63。

## 事故关闭证据（真实 runtime retry）

- 在 Hub 3005 的 `a2a-测试2` 点击失败消息“重试”。
- 新 invocation 创建 `1795829727722`，完成 `1795829763292`；原 invocation 由 failed
  转 completed（retry_count 1）。
- deepseek attempt `6`：`handled`，真实 worker
  `w:sess:thread:ea140b...:agentd-4eeb:0:179582972...`。
- agentd 成功派发 multi_mention；agentA/B/C 各自真实 worker，三次回复全部收到；
  aggregate `seq 13`，agentd 结论 `seq 14`。
- 并行结果：三路 START 极差 0.581s，重叠约 19.42s；墙钟 22.68s（串行约 62s）。
- 浏览器 console errors `0`；无新的 retry-exhausted 消息。

## 后续

- 非阻塞 review 建议：把 `pi-spawn` 的两处 path resolver 也纳入 path-anchor 测试。
- move checklist 增加“`import.meta` fs 锚点逐一重推深度”；F051a review 曾核移动纯度，
  但未把路径敏感文件列入强制检查，导致本回归进入生产。

[宪宪/deepseek-flash🐾]
