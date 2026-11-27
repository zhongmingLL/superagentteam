---
title: "Daemon module layout — Clowder-aligned redesign"
doc_kind: architecture
status: implemented
created: 2026-11-27
updated: 2026-11-28
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: [砚砚 (GLM 5.3 Flash), 墨墨 (Qwen 3.8 Flash)]
related_features: [superagentteam/F051]
source_decision: "operator 2026-11-27: packages/superagentteam-daemon/src 目录设计很垃圾，参考 Clowder 重新设计"
---

# Daemon module layout — Clowder-aligned redesign

> **F051（2026-11-28）**：F051a 顶层同名分裂/`app/` composition roots/`pi-worker`/
> `infrastructure` 已落地；F051b 完成 `domains/a2a` ingress/routing/tools、
> `domains/execution|agents`、`domains/queue` 子目录、`domains/invocation` records/
> attempts/turns/settlement/aggregate/recovery/read-models 拆分。目标树已落地。

## 0. 结论

当前目录不是“按领域分层”，而是“历史文件堆叠”。本设计参考 Clowder 的
**domain-first + store/service/port 分离 + composition root 外置**，把 daemon
收敛为：`app/`、`api/`、`cli/`、`domains/`、`infrastructure/`、`memory/`、
`observability/`、`pi-worker/`、`shared/`。

这是 **F051 的 mechanical refactor**：只移动/拆分文件、更新 import，不改变行为。

## 1. 当前问题

### 1.1 混合抽象层

- `domains/a2a/runtime.ts` 是 composition root，却放在 domain 内；
- `domains/a2a/tool-service.ts`、`thread-context.ts`、`control.ts`、`loop-guard.ts`、
  `observation.ts` 混在同一层；
- `domains/agent/turn.ts` 是 per-target execution，不属于 agent config；
- `domains/invocation/settlement.ts` 同时放 T1/T2/T4，`processor.ts` 同时放 claim、
  dispatch、T3 aggregate；
- `domains/queue/store.ts` 同时承担 `InvocationQueue` 服务与 `QueueLedgerStore` 持久层。

### 1.2 同名不同义

| 名称 | 当前用法 A | 当前用法 B | 问题 |
|---|---|---|---|
| `auth/` | operator/principal/token/auth | `domains/auth/store.ts` invocation credential | 两个 auth 域混在一起 |
| `runtime/` | 进程 supervisor（daemon/web 启停） | `domains/a2a/runtime.ts` A2A composition root | “runtime”一词两种含义 |
| `workers/` | pi worker extension/RPC client | `domains/worker/` daemon-side pool/store | worker 两侧混名 |
| `control/` | control socket errors | `api/` HTTP transport | control plane 边界不清 |
| `errors.ts` | daemon lifecycle errors | `control/errors.ts` control errors | 错误域重叠 |

### 1.3 结果

- 新猫要读很多文件才知道一条 A2A 消息从 ingress 到 T1–T4 的 owner；
- 同一个概念（queue、settlement、worker）横跨多个目录；
- route 层缺失时，`domains/a2a` 看起来“什么都有”，实际没有 AgentRouter/routeParallel；
- 目录本身在鼓励继续把新逻辑塞进 `domains/a2a` / `domains/invocation`。

## 2. 目标结构

```text
packages/superagentteam-daemon/src/
  app/
    daemon.ts                 # daemon lifecycle entry / composition
    daemon-a2a.ts             # A2A drain loop
    a2a-runtime.ts            # A2ARuntime composition root（原 domains/a2a/runtime.ts）
    boot-ledger.ts
    installation.ts
    state.ts
    fence.ts
    data-dir.ts
    paths.ts

  api/                        # HTTP transport（保留）
    http.ts session.ts static.ts browser.ts console-link.ts
    routes/

  cli/                        # CLI transport（保留）

  domains/
    access/                   # operator/principal/token/auth（原顶层 auth/）
    accounts/                 # provider catalog/store（原 domains/account/）
    agents/                   # catalog-store/registry/mentions（原 domains/agent/）
    execution/                # runAgentTurn + invokeSingleAgent（原 domains/agent/turn.ts + 新）
    a2a/
      ingress/                # OperatorMessageIngress/target resolution
      routing/                # AgentRouter/routeParallel/routeSerial
      tools/                  # A2AToolService/thread_context/control
      multi-mention/          # orchestrator/store/status
      loop-guard.ts
      observation.ts
    invocation/
      records/                # InvocationRecordStore
      attempts/               # InvocationAttemptStore
      turns/                  # TurnExecutionStore/TurnExecutionLifecycle（T1）
      settlement/             # RouteResponseCommitter（T2）/ResponseRecoveryService（T4）
      aggregate/              # collector + parent aggregate（T3）
      recovery/               # startup reconciler + owner reaper
      read-models/            # LiveInvocations
    queue/
      ledger/                 # InvocationQueue + QueueLedgerStore
      processor/              # QueueProcessor（claim/Phase A/B/T3 wiring）
      tracker/                # InvocationTracker
    context/                  # HistoryAssembler + delivery cursor
    messages/                 # MessageStore + AgentReadStateStore
    threads/                  # ThreadStore
    sessions/                 # AgentSessionStore
    credentials/              # InvocationCredentialStore（原 domains/auth/store.ts）
    workers/                  # WorkerPool/WorkerStore/WorkerBindingStore/spawn
    streaming/                # ResponseDraftStore/ResponseEventSink
    rich-blocks/              # RichBlockService/tool-surface

  infrastructure/
    db/                       # schema/migrations/database
    process/                  # process identity/health/signal（原 lifecycle/）
    supervisor/               # runtime process supervisor（原 runtime/）
    events/                   # ChangeBus（原 domains/events/）
    canonical-json.ts

  memory/                     # platform subsystem（保留）
  observability/              # platform subsystem（保留）
  pi-worker/                  # worker-side extension + RPC client（原 workers/）
  shared/                     # errors/env/control-errors/canonical helpers
  index.ts                    # package public surface（最小）
```

## 3. 迁移映射（current → target）

| 当前 | 目标 | 说明 |
|---|---|---|
| `daemon.ts` / `daemon-a2a.ts` | `app/daemon.ts` / `app/daemon-a2a.ts` | app 只做 composition/lifecycle |
| `boot-ledger.ts` / `installation.ts` / `state.ts` / `fence.ts` / `data-dir.ts` / `paths.ts` | `app/*` | daemon 安装/启动状态 |
| `env.ts` / `errors.ts` / `control/errors.ts` | `shared/env.ts` / `shared/errors/*.ts` | 共享基础类型 |
| `auth/*` | `domains/access/*` | operator/principal/token/auth |
| `domains/auth/store.ts` | `domains/credentials/store.ts` | invocation credential |
| `domains/a2a/router.ts` | `domains/a2a/ingress/router.ts` | ingress |
| `domains/a2a/tool-service.ts` / `thread-context.ts` / `control.ts` | `domains/a2a/tools/*` | model-facing tools |
| `domains/a2a/runtime.ts` | `app/a2a-runtime.ts` | composition root |
| `domains/a2a/loop-guard.ts` / `observation.ts` | `domains/a2a/*` | A2A 读模型/观测 |
| `domains/multi-mention/*` | `domains/a2a/multi-mention/*` | A2A group lifecycle |
| `domains/agent/catalog-store.ts` / `registry.ts` / `mentions.ts` | `domains/agents/*` | config/registry |
| `domains/agent/turn.ts` | `domains/execution/run-agent-turn.ts` | per-target execution |
| `domains/history/assembler.ts` | `domains/context/history-assembler.ts` | context |
| `domains/message/store.ts` | `domains/messages/store.ts` | message/read state |
| `domains/thread/store.ts` | `domains/threads/store.ts` | thread |
| `domains/session/store.ts` | `domains/sessions/store.ts` | session |
| `domains/worker/*` | `domains/workers/*` | daemon-side worker |
| `workers/*` | `pi-worker/*` | worker-side extension/RPC |
| `domains/response/*` | `domains/streaming/*` | draft/sink |
| `domains/rich-block/*` | `domains/rich-blocks/*` | rich block |
| `domains/account/*` | `domains/accounts/*` | provider catalog |
| `domains/events/bus.ts` | `infrastructure/events/bus.ts` | cross-cutting bus |
| `domains/queue/store.ts` | `domains/queue/ledger/store.ts` | `InvocationQueue` + ledger |
| `domains/queue/processor.ts` | `domains/queue/processor/processor.ts` | scheduler |
| `domains/queue/tracker.ts` | `domains/queue/tracker/tracker.ts` | slots |
| `domains/invocation/store.ts` | `domains/invocation/{records,attempts,turns}/*` | 按 store 拆 |
| `domains/invocation/settlement.ts` | `domains/invocation/{turns,settlement}/*` | T1/T2/T4 拆 |
| `domains/invocation/recovery.ts` | `domains/invocation/recovery/*` | startup/reaper 拆 |
| `domains/invocation/aggregate.ts` / `collector.ts` | `domains/invocation/aggregate/*` | T3 |
| `domains/invocation/live.ts` | `domains/invocation/read-models/live.ts` | read model |
| `runtime/*` | `infrastructure/supervisor/*` | 进程 supervisor |
| `lifecycle/*` | `infrastructure/process/*` | process identity/health/signal |

> 具体文件拆分以 F044–F048 完成后的文件为准；F051 只做 move/rename + import 更新，
> 不再引入新语义。

## 4. 依赖规则

1. `shared/` 不 import 任何 domain/infrastructure/app。
2. `infrastructure/` 只 import `shared/`；不 import domain/app。
3. `domains/` 可以 import `shared/`/`infrastructure/`；跨 domain 只用 public `index.ts`
   或显式 port，不直接 import 对方内部 store。
4. `app/` 是唯一 composition root；domain 不 import app。
5. `api/`/`cli/` 只调用 app/domain 的 public API，不绕过 service 直接写 store。
6. `pi-worker/` 只 import shared tool specs/RPC types，不 import daemon domain store。
7. 不再出现顶层 `auth/`、`runtime/`、`workers/`、`control/` 的同名分裂。

> 规则 3/5 是目标态；F051 先保证目录与直接 import 方向，深度依赖倒置按后续 feature
> 渐进，不做 big-bang。

## 5. 迁移步骤（F051）

1. **Freeze**：F044–F048 语义整改先完成；期间不改目录，避免冲突。
2. **Move-only**：移动/重命名文件；用脚本更新相对 import；不改代码逻辑。
3. **Split**：把 `settlement.ts`/`queue/processor.ts`/`a2a/runtime.ts` 等混合文件按
   target tree 拆成小文件；每拆一个跑定向测试。
4. **Barrels**：为每个 domain 建最小 `index.ts`；避免 wildcard 掩盖循环依赖。
5. **Guard**：新增 `scripts/check-daemon-layout.mjs`（或扩展 `check:ts-imports`）：
   - 禁止顶层 `auth/`/`runtime/`/`workers/`/`control/` 复活；
   - 禁止 `domains/*` import `app/`；
   - 禁止 `api/`/`cli/` 直接 import `domains/*/store`（只走 public API）。
6. **Verify**：daemon full tests、typecheck、doc-index、layout guard；CI 绿。

## 6. 非目标

- 不改 A2A 语义、DDL、API schema；这些是 F044–F048/F050。
- 不做 big-bang 依赖倒置或全仓 ports/adapters 重写。
- 不改 `memory/`/`observability/` 的内部结构；它们是 platform subsystem。
- 不把 `packages/superagentteam-web` 拉进来；前端目录另议。

## 7. 风险 / 回滚

- **大 diff/merge 冲突**：排在语义整改之后，单分支完成；期间冻结其他 daemon 改动。
- **import 循环**：barrel + layout guard；拆文件时先跑 typecheck。
- **测试路径**：相对 import 更新后跑 daemon full suite；不做行为改动。
- **回滚**：F051 是纯 move/rename，可 revert 分支；无数据/schema 变更。

[宪宪/deepseek-flash🐾]
