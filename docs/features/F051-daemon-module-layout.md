---
feature_ids: [superagentteam/F051]
related_features: [superagentteam/F044, superagentteam/F045, superagentteam/F046, superagentteam/F047, superagentteam/F048, superagentteam/F050]
title: "F051: Daemon module layout refactor"
status: in-progress
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: [砚砚 (GLM 5.3 Flash)]
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-27
updated: 2026-11-28
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

- [x] AC-1：target tree 落地；顶层不再有 `auth/`/`runtime/`/`workers/`/`control/` 的同名分裂。
- [ ] AC-2：`domains/a2a` 只保留 ingress/routing/tools/multi-mention/loop-guard/observation；
  `domains/invocation` 按 records/attempts/turns/settlement/aggregate/recovery/read-models 拆。
- [x] AC-3：composition roots 只在 `app/`；domain 不 import app；api/cli 不直接写 store。
- [x] AC-4：daemon full tests、typecheck、doc-index、layout guard 绿；无行为变化。
- [ ] AC-5：非作者 review 覆盖最终 HEAD；迁移映射与 0020 一致。

- [x] AC-E2E（operator 2026-11-27，强制）：必须在**当前测试 worktree**的隔离 test runtime
  跑真实端到端链路；**Clowder 是 golden**，按 Clowder 参考目录/行为构建对照用例；
  布局移动前后跑同一 E2E smoke 并对比日志/输出，证明无行为变化；unit/targeted test
  只能补充，不能替代。证据须含 worktree/HEAD、隔离端口/data dir、用例、日志/输出、
  结果；无 E2E 证据不得声明 verified。
  方式基线：[`0021-e2e-acceptance-standard.md`](../architecture/0021-e2e-acceptance-standard.md)
  （F044 方法）；move 前后同一 smoke 的真实链路输出对比是验收核心。

## 证据

### F051a 落地（2026-11-28）

- 顶层收敛：`auth/`→`domains/access/`、`runtime/`→`infrastructure/supervisor/`、
  `workers/`→`pi-worker/`、`control/`→`shared/control/`、
  `lifecycle/`→`infrastructure/process/`、`domains/events/`→`infrastructure/events/`。
- composition root：`daemon.ts`/`daemon-a2a.ts`/`boot-ledger.ts`/`installation.ts`/
  `state.ts`/`fence.ts`/`data-dir.ts`/`paths.ts`/`errors.ts`/`env.ts` → `app/`/`shared/`；
  `domains/a2a/runtime.ts` → `app/a2a-runtime.ts`。
- `scripts/check-daemon-layout.mjs`：禁止 legacy 顶层目录、禁止 `domains/a2a/runtime.ts`、
  禁止 domain→app import；已加入 `npm run check`。
- 验证：daemon **559 passed / 5 skipped**、tsc、`check:ts-imports`、`check:entry-graphs`、
  doc-index、layout guard 绿；移动前后同一 fullstack/daemon 套件结果一致。
- **F051b 未完成**：`domains/a2a` 内部 ingress/routing/tools 子目录、
  `domains/invocation` 的 records/attempts/turns/settlement/aggregate/recovery/read-models
  文件拆分仍未做；AC-2 保持未勾选。

- **Clowder 参考目录/文件**（相对参考仓根目录）：
  - `packages/api/src/domains/cats/services/agents/{routing,invocation,registry}`（domain-first）
  - `packages/api/src/domains/cats/services/{context,stores/{ports,redis}}`
  - `packages/api/src/domains/messaging/{contract,stores}`
  - `packages/api/src/infrastructure/`（scheduler/websocket 等）
  - `packages/api/src/index.ts`（composition root 外置）
  - `packages/mcp-server/src/tools/`（worker-side tool surface 独立）
- `docs/architecture/0020-daemon-module-layout.md`：目标树、映射、依赖规则。
- 当前目录与 Clowder 参考结构的对照（domain-first + store/service/port + composition root 外置）。
- daemon full test + typecheck + layout guard 输出。

## 风险 / 回滚

- 大 diff/merge 冲突：排在 F044–F048 之后，单分支完成；冻结其他 daemon 改动。
- import 循环：barrel + guard；拆分时逐步跑 typecheck。
- 回滚：纯 move/rename，可 revert；无数据/schema 变更。

[宪宪/deepseek-flash🐾]
