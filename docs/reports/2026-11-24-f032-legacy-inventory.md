---
title: "F032 legacy inventory — task-first retirement"
doc_kind: report
status: draft-for-review
created: 2026-11-24
updated: 2026-11-24
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
related_features: [superagentteam/F032, superagentteam/F018]
archive_tag: "archive/task-first-v1"
archive_commit: "dd29e1cabbcf7907ee001c6c9440164697d0747e"
source_decision: "operator 2026-11-24: no legacy engine/control.db usage or data; F032 archive then delete"
---

# F032 legacy inventory

## 0. Archive 坐标

- tag：`archive/task-first-v1`
- commit：`dd29e1cabbcf7907ee001c6c9440164697d0747e`
- 含义：最后一个包含 frozen task-first runtime 的 commit；删除后可从这里恢复代码。

## 1. 体量

| 范围 | 数量 / 大小 |
|---|---|
| `packages/superagentteam-daemon/src/legacy/task-first/` | 88 files / 800K |
| `docs/legacy/task-first/` | 6 files / 40K |
| `scripts/legacy-boundary-allowlist.json` | 55 entries |
| 非 legacy 源码中对 legacy 的 import 引用 | 104 refs / 52 files |
| 直接 import legacy 的测试 | 3 files |

legacy 顶层目录：`a2a`、`control`（含 migrations/stores）、`custody`、
`deployment-wait`、`dispatch`、`gates`、`managed-work`、`merge`、`review`、
`scheduling`、`sop`。

## 2. 非 legacy 代码里的入口 / shim

这些文件不是 legacy 本体，但会 re-export 或依赖 legacy；F032.2 要逐项删除/改写：

- `a2a/`：`index.ts`、`observation.ts`、`principal.ts`、`requests.ts`、
  `terminal.ts`、`tool-surface.ts`、`tools.ts`（v1 的真实 surface 在
  `domains/a2a/`，这些是旧 path shim）。
- `control/`：`index.ts`、`migrations/index.ts`、`read-models.ts`、`store.ts`、
  `stores/types.ts`；以及 `control/stores/` 下面由 allowlist 覆盖的 16 个旧 store。
- 顶层 shim：`custody/index.ts`、`deployment-wait/*`、`dispatch/*`、
  `gates/*`、`managed-work/index.ts`、`merge/executor.ts`、`review/*`、
  `scheduling/*`、`sop/*`。
- 仍有 legacy 注释/旧路径分支的 v1-adjacent 文件：`auth/mint.ts`、
  `auth/merge-credential.ts`、`policy/handoffs.ts`、`workers/{control,event-sink,
  executor,failure-policy,harness,prompt,registry,runtime,tool-policy,
  worker-extension}.ts`、`observability/{contracts,tracer,trajectory}.ts`、
  `eval/*`、`auth/liveness.ts`。这些要按“是否仍有 v1 消费者”逐个判，不能整目录盲删。

## 3. Allowlist 分布

| owner | entries | 说明 |
|---|---:|---|
| R5 | 23 | legacy CLI/eval/observability/auth consumer，优先删除 |
| R1-b | 16 | 旧 control stores / barrels，v1 domain stores 已替代 |
| R2 | 12 | task-bound worker/harness/policy 分支 |
| R1-c | 3 | credential/auth rebuild 过程中的旧路径 |
| R1-a | 1 | package barrel (`index.ts`) |

F032.2 完成时，allowlist 应只剩仍被 v1 使用的 shim（若有）；stale entry 由
`check-legacy-boundary` 自动报错。

## 4. CLI / daemon 入口

- `thread`：默认 `engine=a2a`，v1 使用 `cli/thread-a2a.ts`；`--engine legacy`
  才走 `cli/thread.ts` + control.db。F032.1 应移除 `--engine legacy`（或 typed reject）。
- `startDaemon`：`controlPlane` 是显式 legacy option；默认/`a2aControlPlane` 走
  A2A。F032.1 应移除公开 legacy option。
- 仍是 legacy/control.db 命令（F032.1 逐项确认）：
  `backlog`、`sop`、`task`、`approval`、`budget`、`deployment`、`schedule`、
  `session`、`profile`、`gate`、`merge`、`eval`。
- v1/保留候选：`thread`（A2A）、`daemon`、`auth`、`memory`。
- 旧 `thread` flags `--backlog` / `--task` / `--kind` 已被 A2A 命令 typed reject；
  删除 legacy engine 后这些错误文案也要同步。

## 5. 直接 import legacy 的测试

- `packages/superagentteam-daemon/test/control-gate-evaluators.test.ts`
- `packages/superagentteam-daemon/test/control-gate-risk.test.ts`
- `packages/superagentteam-daemon/test/control-sop-catalog.test.ts`

这三个测试属于 legacy gate/SOP 覆盖；F032.2 删除对应代码时一并移除，不保留“测试绿”
假象。

## 6. 保留项

- `docs/architecture/0006-task-first-legacy.md`：历史架构卡，标 non-normative；
- `docs/legacy/task-first/INDEX.md` + 5 篇历史 feature：作为 archive 保留；
- decision packet / feature 历史 / 最终删除报告；
- boundary guard 及其 negative test；
- 任何 v1 仍在使用的 auth/daemon/observability 代码（逐个判，不按目录盲删）。

## 7. 后续切片

| 切片 | 动作 | 出口 |
|---|---|---|
| F032.0 | 本文 + tag `archive/task-first-v1` | archive 坐标可回滚 |
| F032.1 | 移除 `--engine legacy` / `controlPlane` / legacy-only CLI | help/错误文案一致 |
| F032.2 | 删除 legacy code/shims/tests/allowlist | `rg` 无活跃 import |
| F032.3 | 历史留存 + 防回流 negative test | 文档 non-normative + guard |
| F032.4 | full build/check/test + A2A E2E | 无回退 |

## 8. 验证基线

```bash
NODE_ENV=development npm run build:offline
NODE_ENV=development npm run check
NODE_ENV=development npm test -w @superagentteam/daemon
rg -n 'legacy/task-first|--engine legacy|controlPlane' packages/superagentteam-daemon/src packages/superagentteam-daemon/test scripts
```

删除后 `rg` 只应命中历史 docs / archive 说明；不应命中可执行源码或测试。

[宪宪/deepseek-flash🐾]
