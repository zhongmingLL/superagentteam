---
feature_ids: [superagentteam/F051]
related_features: [superagentteam/F044, superagentteam/F045, superagentteam/F046, superagentteam/F047, superagentteam/F048, superagentteam/F050]
title: "F051: Daemon module layout refactor"
status: planned
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: []
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-27
updated: 2026-11-27
source_decision: "operator 2026-11-27: packages/superagentteam-daemon/src 目录设计很垃圾，参考 Clowder 重新设计"
---

# F051: Daemon module layout refactor

> **先读（强制）**：
> - [`0020-daemon-module-layout.md`](../architecture/0020-daemon-module-layout.md)：目标目录与迁移映射。
> - [`0007-a2a-runtime-chain.md`](../architecture/0007-a2a-runtime-chain.md)：组件 owner。
> - [`0019-a2a-runtime-chain-as-built.md`](../architecture/0019-a2a-runtime-chain-as-built.md)：当前 as-built。
> - [`0050-a2a-runtime-alignment.md`](../plans/0050-a2a-runtime-alignment.md)：本计划。
>
> 本 feature 是 **mechanical layout refactor**：只移动/拆分文件、更新 import；
> 不改 A2A 语义、DDL、API。必须在 F044–F048 语义整改之后做，避免冲突。

## Why

operator 2026-11-27：当前 `packages/superagentteam-daemon/src` 目录设计很乱，
参考 Clowder 重新设计。当前问题：

- `domains/a2a` 混 ingress/routing/tools/control/read model/composition root；
- `domains/invocation` 混 store/T1/T2/T4/aggregate/read model；
- `domains/agent/turn.ts` 是 execution，不是 agent config；
- 顶层 `auth/` vs `domains/auth/`、`runtime/` vs `domains/a2a/runtime.ts`、
  `workers/` vs `domains/worker/` 同名不同义；
- 目录在鼓励继续把新逻辑塞进已有大 domain。

## 用户结果

- 一条 A2A 消息从 ingress → route → runAgentTurn → T1–T4 的 owner 在目录上一眼可见。
- store/service/composition/transport 分层清楚；新逻辑有明确落点。
- 不再有同名不同义的顶层目录。
- 纯 move/rename，不改变运行时行为；测试/API/DDL 不变。

## 范围

- 按 `0020-daemon-module-layout.md` 的 target tree 移动/重命名文件。
- 拆分混合文件：`a2a/runtime.ts`、`invocation/settlement.ts`、`queue/processor.ts` 等。
- 建立 domain 最小 `index.ts`；更新相对 import。
- 新增 layout guard（`scripts/check-daemon-layout.mjs` 或扩展 `check:ts-imports`）。
- 更新 docs/architecture map、README、测试路径。

## 非目标

- 不改 A2A route/context/tool/queue 语义（F044–F048）。
- 不改 DDL/API schema（F047/F050）。
- 不做 big-bang ports/adapters 重写。
- 不改 memory/observability 内部结构。
- 不改前端目录。

## 验收

- [ ] AC-1：target tree 落地；顶层不再有 `auth/`/`runtime/`/`workers/`/`control/` 的同名分裂。
- [ ] AC-2：`domains/a2a` 只保留 ingress/routing/tools/multi-mention/loop-guard/observation；
  `domains/invocation` 按 records/attempts/turns/settlement/aggregate/recovery/read-models 拆。
- [ ] AC-3：composition roots 只在 `app/`；domain 不 import app；api/cli 不直接写 store。
- [ ] AC-4：daemon full tests、typecheck、doc-index、layout guard 绿；无行为变化。
- [ ] AC-5：非作者 review 覆盖最终 HEAD；迁移映射与 0020 一致。

## 证据

- `docs/architecture/0020-daemon-module-layout.md`：目标树、映射、依赖规则。
- 当前目录与 Clowder 参考结构的对照（domain-first + store/service/port + composition root 外置）。
- daemon full test + typecheck + layout guard 输出。

## 风险 / 回滚

- 大 diff/merge 冲突：排在 F044–F048 之后，单分支完成；冻结其他 daemon 改动。
- import 循环：barrel + guard；拆分时逐步跑 typecheck。
- 回滚：纯 move/rename，可 revert；无数据/schema 变更。

[宪宪/deepseek-flash🐾]
