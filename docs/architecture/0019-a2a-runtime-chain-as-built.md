---
title: "SuperAgentTeam A2A runtime chain — as-built"
doc_kind: architecture
status: as-built
created: 2026-11-27
updated: 2026-11-27
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
doc_role: "current implementation truth; 0007 remains the target-design/history document"
evidence_baseline: "code f51d9f3c7; docs 23298eeab; live 3005/3014 f51d9f3c7"
---

# SuperAgentTeam A2A runtime chain — as-built

## 0. 读法

- **0007** = 2026-11-06 的 Clowder-aligned **target contract** + 决策历史；不再作为
  “当前实现了什么”的真相源。
- **0019（本文）** = 当前实现的 as-built 真相。所有“当前 owner / 实际调用 / 实际 API /
  实际 DDL”以本文为准。
- **编号别名**：本文原文件名是 `0008-a2a-runtime-chain-as-built.md`（operator 所说的
  “0008 as-built”）；因与已有 `0008-agent-config.md` 撞号，改为 0019。
- 逐项偏移证据见 `docs/reports/2026-11-27-0007-as-built-audit.md`。
- 本文不是把 0007 的设计目标判死：每个偏离点在 §8 标明 **ratified / implementation
  decision / unratified deviation / code gap**，并在 §9 给出整改选项。

## 1. As-built 链路

```text
OperatorMessageIngress（domains/a2a/router.ts）
  → invocation_queue（QueueLedgerStore）
  → QueueProcessor.processEntry（domains/queue/processor.ts）
      Phase A 单事务：parent InvocationRecord + 每个 target attempt starting
      InvocationTracker.startAll(thread, claimed targets)
      AgentRouter.routeAgents(preparedTargets, parallel|serial)
  → AgentRouter（domains/agent/route.ts）
      routeParallel：批次 barrier 先装配全部 target context（history snapshot +
        prompt），再启动任何 runner；单 target 错误隔离
      routeSerial：单 target operator/A2A hop 的 assemble → run → T2 → release；
        多 target serial 时后续 target 收到 priorResponses
  → RunAgentTurn.run（domains/agent/turn.ts）
      InvokeSingleAgent.begin：Phase B 单事务（processing R +
        TurnExecution.createRunning + bindAppended + credential + draft +
        input dispatchRef + retireTargets）
      workerPool.ensure + bindWorker + promptAndWait
      stream → ResponseEventSink → onStreamEvent
      T1 TurnExecutionLifecycle.invokeTerminal
  → route：T2 RouteResponseCommitter.commit → completion.release()
  → QueueProcessor finally：aggregateParent（collectTerminalDispositions +
      applyTerminalAggregate）；tracker.complete；releaseClaim
  → ResponseRecoveryService（T4）
```

`runAgentTurn` 不是 async generator：`TurnRunner.run(input)` 返回
`AgentTurnCompletion`（`result` + `release()`）。route 用 `Promise.all` 并发启动
`routeParallel` 的 runner，没有独立 `mergeStreams` 模块；stream 仍经
`ResponseEventSink` → `onStreamEvent`。

## 2. As-built ownership

| 面 | 实际 owner |
|---|---|
| `@` 解析 / target resolution | `OperatorMessageIngress` |
| queue admission / cap / claim | `QueueLedgerStore` + `QueueProcessor` |
| parent / Phase A | `QueueProcessor.processEntry` |
| parallel barrier / serial worklist / priorResponses | `AgentRouter`（`route.ts`） |
| Phase B（R + TurnExecution + credential + draft + retire） | `InvokeSingleAgent.begin`，由 `RunAgentTurn.run` 调用 |
| `tracker.startAll` | `QueueProcessor` |
| per-target worker / prompt / stream / T1 | `RunAgentTurn` + `TurnExecutionLifecycle` |
| T2 response commit | `AgentRouter` → `RouteResponseCommitter.commit` |
| provider-phase failure convergence（Phase B 已提交后） | `QueueProcessor.convergeProviderFailure` |
| T3 collector + parent aggregate | `QueueProcessor`（`aggregateParent`；`collectTerminalDispositions` + `applyTerminalAggregate`） |
| T4 recovery | `ResponseRecoveryService` |
| live/queue 读模型 | `domains/invocation/live.ts` + `api/routes/{queue,live}.ts` |

## 3. 组件 as-built

### 3.1 OperatorMessageIngress

- `domains/a2a/router.ts`：operator 显式 `@` 解析、隐式 5 步 fallback、message + queue
  同事务 admission；`StoredMessage.targetAgentIds` 只用于 user message。
- 没有独立的 `AgentRouter` 类；target 解析/校验在 ingress 完成。

### 3.2 QueueProcessor

- 实际构造依赖（`QueueProcessorDeps`）：`db`、`registry`、`queue`、`records`、`turns`、
  `attempts`、`sessions`、`credentials`、`drafts`、`messages`、`threads`、`tracker`、
  `router`、`multiMention`、`multiMentionOrchestrator`、`capacity`、`log`、`clock`、`owner`。
  `credentials`/`drafts` 只服务 provider-phase failure convergence；Phase B 不再由
  processor 写。
- 公开方法：`drain(threadId, userId, {maxEntries})`、`drainAll(maxEntries)`、
  `processEntry(entry, claimId, userId)`、`requestRetry(invocationId, targets?)`、
  `abandon(invocationId)`；`isThreadBusy` / `isAgentBusy` / `hasQueuedForThread`。
- `processEntry` 顺序：claim 校验 → preflight（`agent_not_found` / `agent_disabled` /
  `account_not_found`；`worker_capacity` defer）→ Phase A 单事务 → `tracker.startAll`
  → `AgentRouter.routeAgents`（Phase B 在各 runner 内）→ 错误分类 → `finally` 释放
  tracker/claim + T3 aggregate。
- route 错误分类（F044b）：
  - route 装配失败或 runner 抛出 `PhaseBError`（无 `turn_execution_id`）→ attempt
    `starting→failed` + `delivery_failure`，target 保持 pending，bounded backoff 重试；
  - Phase B 已提交后 provider-phase 失败 → `convergeProviderFailure` 收敛 child/R/
    credential 并恢复 target；
  - `PhaseBError.failureRecorded=false`（清理事务也失败）→ processor 重试一次共享
    prestart 记录，仍失败则进入 `convergenceFailed`。
- F048 仍待处理 bounded concurrent drain 的精确上限；`DaemonA2A.tick` 目前最多 8 个
  并发 drain。

### 3.3 AgentRouter + RunAgentTurn + invoke-single-agent

- `domains/agent/route.ts`：`AgentRouter` 拥有 parallel barrier、serial worklist、
  `priorResponses`、per-target 错误隔离、T2 commit 与 carrier release 时机。
  `routeParallel` 先同步装配所有 target 的 `TurnContext`（history window + prompt），
  再 `Promise.all` 启动 runner；`routeSerial` 单 target 仍走
  assemble → run → T2 → release，多 target 时把前序 `responseText` 作为
  `priorResponses` 加入下一个 prompt。
- `domains/agent/turn.ts`：`RunAgentTurn` 实现 `TurnRunner.run(input):
  Promise<AgentTurnCompletion>`。顺序：`invoke-single-agent.begin`（Phase B）→
  校验 session/attempt → `pool.ensure` → `bindWorker` → `promptAndWait` → sink →
  T1 `TurnExecutionLifecycle.invokeTerminal` → 返回 `result + release()`。
  route 在 T2 commit 之后调用 `release()`；T1 仍是 child terminal 的唯一写入点。
- `domains/agent/invoke-single-agent.ts`：Phase B owner。`begin(prepared)` 在一个事务内
  写 processing R + `TurnExecutionStore.createRunning` + `bindAppended` +
  credential + draft + input dispatchRef + `retireTargets`。Phase B 失败抛
  `PhaseBError`：attempt `starting→failed`（terminalReason `phase_b_failed`）+
  步骤化 `delivery_failure` reason（`turn_create_failed` / `response_create_failed` /
  `credential_mint_failed` / `draft_create_failed` / `retire_targets_failed` /
  `phase_b_failed`），target 保持 pending。attempt 不在 `starting` 时不写任何终态
  （`failureRecorded=false`）。
- 生命周期日志：daemon 把 `A2ALog` 接到本地 JSONL，关键事件包括
  `phase_b_appended`、`turn_worker_bound`、`turn_terminal`、`phase_b_failed`、
  `queue_route_setup_failed`、`route_t2_commit_failed`。
- 已知显式映射：`runAgentTurn` 不是 async generator；`RouteResponseCommitter.commit`
  输入是 `{turnExecutionId, responseText?, thinking?}`（P3-b 对齐），不是整个
  `AgentTurnResult`。F047 统一文档/API 表述。

### 3.4 Stores / recovery

- `InvocationRecordStore`：`create`、`get`、`byThreadSource`、`markRunning`、
  `addSuccessfulAgents`、`setTerminal`、`applyTerminalAggregate`、`abandon`、`admitRetry`。
- `TurnExecutionStore`：`createRunning`、`get`、`listByInvocation`、`listRunning`、
  `transitionTerminal`、`interruptRunningBefore`、`listResponsePending`、
  `clearResponsePending`。
- `InvocationAttemptStore`：append-only attempt 台账（`appendQueued`、`markStarting`、
  `bindAppended`、`bindWorker`、`markPromptDelivered`、`setSettlement`、
  `projectChildTerminal`、`markPrestartTerminal`、`recordUsage`）。
- `InvocationCredentialStore`（不是 `InvocationRegistry`）：token hash/salt、
  `allowedTools`、`toolCallClaims`、`state/disposition`。
- `ResponseDraftStore`：content/toolEvents/thinking/**richBlocks** 全量 snapshot。
- `InvocationTracker`：per-(thread, agent) in-process 槽；`startAll` 返回
  `Map | { error: "slot_busy"; agentId }`（all-or-nothing）。
- `TurnExecutionStartupReconciler` / `InvocationOwnerReaper` / `ResponseRecoveryService`：
  startup/运行期/T4 三条恢复路径；无 `TrajectoryProjector`（v1 不做）。

### 3.5 A2A tools / multi-mention

- `A2A_V1_TOOL_NAMES`：`post_message`、`cross_post_message`、`multi_mention`、
  `thread_context`；另有独立 rich-block producer tool
  `superagentteam_create_rich_block`（F031，同一 control socket）。
- `A2AToolService.postMessage`：targets=1 时 message + `message_wake`；targets=0 仅 message。
- `MultiMentionOrchestrator`：request + source message + queue entry（同一事务）；
  callback aggregate 通过 `multi_mention_callbacks` 交付。
- F043：multi-mention 提问追加“回答自动汇总，不需要 post_message”；target 向 initiator
  的重复 post_message 在创建 message/queue 前返回 `multi_mention_auto_delivery`。

## 4. 数据模型 as-built

- 迁移源：`packages/superagentteam-daemon/src/infrastructure/db/migrations/`；
  live DB 的 `sqlite_master` 与 0019 基线 `f51d9f3c7` 一致。
- 核心表：`invocation_queue`、`invocation_records`、`turn_executions`、
  `invocation_attempts`、`response_drafts`、`invocation_credentials`、
  `agent_read_state`、`workers`、`worker_bindings`、`messages`、`threads`、
  `agent_sessions`。
- multi-mention：`multi_mention_requests`、`multi_mention_responses`、
  `multi_mention_callbacks`。
- 与 0007 的 DDL 差异（已修正 0007 的两处明确错误）：
  - `invocation_records` 的唯一性是 `UNIQUE(thread_id, source_record_id)`，不是列级
    `source_record_id UNIQUE`（0018 R-01 / DP-F018）。
  - `response_drafts` 有 `rich_blocks_json TEXT NOT NULL DEFAULT '[]'`（F031）。
  - `invocation_queue.owner_json` / `from_json` 的 CHECK 还要求 `json_type='object'`。
- `messages` 的物理映射保持 0007 §3.1.1：`author_kind/author_id` ← `from`，
  `body_md` ← `content`，`content_json` ← `contentBlocks`，`tool_events_json`，
  `lifecycle_json`，`extra_json`，`mentions_user`；legacy `rich_blocks_json` 不再存在，
  rich blocks 在 `extra.rich`。

## 5. 状态机 / T1-T4 as-built

### 5.1 Parent / attempt / turn

- `invocation_records.status`：`queued → running → completed | partial_failed | failed | canceled`；
  `failed/partial_failed → queued`（retry admitted），`failed/partial_failed → canceled`
  （abandon）。
- `invocation_attempts.delivery_state`：`queued → starting → appended → handled | failed |
  interrupted | canceled`；prestart 可直接 `queued/starting → failed | canceled`。
- `invocation_attempts.settlement`：`NULL → streaming → response_pending → settled`。
- `turn_executions.status`：`running → completed | failed | interrupted | canceled`；
  一个 child 一次 terminal。
- `invocation_credentials.state`：`active → terminal`，terminal 带 disposition。

### 5.2 T1-T4

| 层 | 实际 owner | 实际动作 |
|---|---|---|
| Phase B | `InvokeSingleAgent.begin`（`RunAgentTurn.run` 调用） | processing R + TurnExecution.createRunning + bindAppended + credential + draft + input dispatchRef + retireTargets；失败走 typed prestart failure |
| T1 | `TurnExecutionLifecycle`（`RunAgentTurn.run` 调用） | child terminal + attempt projection + `response_pending` + credential terminalize + recordCompletedTurn + cursor ack（promptDelivered gated） |
| T2 | `AgentRouter` → `RouteResponseCommitter.commit` | R terminal（draft content/thinking/toolEvents/richBlocks）+ input refs settle + draft delete + `clearResponsePending` + multi-mention response terminal；失败写日志留 T4 |
| T3 | `QueueProcessor.aggregateParent` | `collectTerminalDispositions` + `applyTerminalAggregate` + queue/tracker/slot |
| T4 | `ResponseRecoveryService` | `response_pending` / `response_missing` 恢复；不改 child/credential，不重跑 T3 |

### 5.3 Phase A / Phase B

- Phase A（QueueProcessor 单事务）：parent create/reuse + markRunning + 每个 target
  `appendQueued → markStarting`。任一 deferred → releaseClaim + defer；invalid target
  在同事务终态化并写 `delivery_failure`。
- Phase B（`InvokeSingleAgent.begin`，每 target 独立事务）：processing R +
  `TurnExecution.createRunning` + `bindAppended` + credential + empty draft +
  input dispatchRef + `retireTargets`。失败 → attempt `starting→failed` +
  step-specific `delivery_failure`，target 保持 pending；不进入 provider convergence。
- route 装配失败发生在 Phase B 之前：processor 用同一 prestart failure 记录
  （`phase_b_failed`，content 带 `route_setup_failed:`），target 仍可重试。
- Phase B 成功但 provider 失败：`convergeProviderFailure` 终端化 child/R/credential，
  恢复 target 给 bounded retry；不写 `delivery_failure`。

## 6. 端到端 as-built

- **operator 多 target**：ingress → 1 queue entry（多 target）→ Phase A →
  tracker.startAll → routeParallel（先装配全部 context，再并发 runner）→ 每个
  runner 内 Phase B → provider → T1 → route T2 → T3 聚合。F043 起 target 并发；
  context 固定在 queue source（`upToSeq`）；A2A hop 用 `includeSourceMessageId`
  保底源消息（cursor 已越过源 seq 时仍可见，不 rewind ack），同批 sibling 不互相看见回答。
- **A2A hop**：`post_message` → 新 message + caller claim 的 pending successor；
  caller T2 提交后 flush 新 queue entry（targets 非空）→ 新 parent → 新 child；
  `a2aDepth + 1`，上限 15。T4 对已 terminal R 补 flush。
- **multi_mention**：1 source message + 1 queue entry + 1 parent + N child；目标回答
  自动汇总；terminal 后 aggregate system message + callback delivery 给 initiator。
- **retry**：同 parent / 同 queue entry，`invocation_attempts` 追加 `attempt+1`；
  `requestRetry` 在 QueueProcessor，store `admitRetry`。
- **cancel**：`POST /api/threads/:threadId/agents/:agentId/cancel` → tracker controller
  abort → child canceled；T3 按 target 聚合。
- **preempt**：tracker slot 被替换时，旧 turn 的 canceled 终态由该 turn 捕获的
  `PreparedDispatch.signal` 决定；converge 不读当前 slot（F048 B5，避免 slot 替换后
  误判 failed + restore target）。
- **recovery**：startup reconciler 处理 crash-prestart/running；reaper 处理运行期僵尸；
  T4 处理 `response_pending` / `response_missing`。
- **读模型**：`/api/threads/:id/queue`（QueueView）、`/api/threads/:id/live`
  （LiveInvocationView）、messages lifecycle；没有 `MessageDispatchSummary` endpoint
  （F016c S0 freeze 已记录 deferred）。

## 7. Deviation register（0007 → as-built）

分类：

- **ratified**：有 feature/decision/plan/PR 记录批准；
- **implementation decision**：R2 实现时在 commit/plan 里明确选择，但未回写 0007/0016；
- **unratified deviation**：与 0001/0002/0004/0005/0016/0024 的硬规则冲突，未找到批准记录；
- **code gap**：文档/契约要求，但代码没有完整实现（属于要修的实现缺口）。

> 逐行细节（doc 位置 / as-built / 类型）见
> `docs/reports/2026-11-27-0007-as-built-audit.md` 的 A–F 表。

### R1 · 调度层：route 层 vs QueueProcessor

- **0007/硬规则**：`A2A ingress → Queue Entry → QueueProcessor → AgentRouter →
  routeSerial/routeParallel → invokeSingleAgent`；复用 1–6/8–10，只替换
  `invokeSingleCat → invokeSingleAgent`（0001 §4、0002 §pi runtime、0004/0005、
  0016 §5.6、0021/0024）。
- **as-built**：没有 AgentRouter/routeAgents/routeParallel/routeSerial；QueueProcessor
  是 scheduler，RunAgentTurn 是 DispatchTargetPort。
- **classification**：**unratified deviation**。R2-a commit `30af728fc` 明确引入
  OperatorMessageIngress + QueueProcessor + dispatch port；R2-b `9624eba0b` 明确
  “execution layer behind the R2-a dispatch port”；没有找到“drop AgentRouter”的决策包/
  review/operator signoff。
- **disposition**：需要 operator 决策 A（ratify 现状）或 B（补 route 层）。
- **F044 resolution（2026-11-27）**：operator 选 B。F044a 恢复 AgentRouter/
  routeParallel/routeSerial/runAgentTurn/T2 owner；F044b 把 Phase B 搬进
  invoke-single-agent。as-built 见 §1–§3。

### R2 · Phase B / T2 ownership

- **0007/0016**：Phase B 在 `invoke-single-agent`/runAgentTurn；T2 在 route/
  `RouteResponseCommitter` 外层；`runAgentTurn` 只 T1。
- **as-built**：Phase B 在 QueueProcessor；T2 在 RunAgentTurn.dispatch；T1 在
  TurnExecutionLifecycle。
- **classification**：**implementation decision**（R2-a commit `30af728fc` 明确 Phase A/B
  在 QueueProcessor；R2-c commit `d933afa2a` 明确 “RunAgentTurn: T1 … T2 best-effort”），
  但与 0007/0016/0024 冲突，未回写。属于“有实现证据、无架构批准”的偏离。
- **disposition**：与 R1 绑定；若 ratify 现状则更新 0016/0024；若补 route 层则把 T2
  移到 route（Phase B 是否移动按 0007 或 0024 再定）。
- **F044 resolution（2026-11-27）**：T2 移到 route，Phase B 移到
  `InvokeSingleAgent.begin`（`RunAgentTurn.run` 调用）；QueueProcessor 只保留
  Phase A/T3 + provider-phase convergence。

### R3 · runAgentTurn / RouteResponseCommitter 接口

- **0007**：`runAgentTurn` async generator，返回 `AgentTurnResult`；committer
  `commit(result)`；`invoke-single-agent` 独立组件。
- **as-built**：`RunAgentTurn.dispatch(prepared): Promise<void>`；committer
  `commit({ turnExecutionId, content, thinking? })`；T1 在 `TurnExecutionLifecycle`。
- **classification**：**implementation decision**（R2-b `9624eba0b` 把 RunAgentTurn 定为
  DispatchTargetPort；R2-c 把 T1/T2 放进 dispatch）。
- **disposition**：若 ratify 现状，0007 target 保留接口历史，0019 作为实际 API；
  若补 route 层，恢复 generator/result 或引入明确的 route result 类型。
- **F044 resolution（2026-11-27）**：采用显式 `TurnRunner.run():
  Promise<AgentTurnCompletion>`（result + release），不恢复 async generator；
  `RouteResponseCommitter.commit` 输入改为 `{turnExecutionId, responseText?,
  thinking?}`。F047 统一文档表述。

### R4 · routeSerial / priorResponses

- **0007/0016/0024**：保留 serial 薄循环，`priorResponses` 供后一个 agent 看前一个
  response；v1 不默认启用。
- **as-built**：没有 serial mode/priorResponses；F043 前是 `processEntry` 的
  `for ... await` 隐式串行（无 priorResponses），F043 起同一 entry 并发 +
  queue source 快照。
- **classification**：**unratified deviation**（没有实现，也没有找到“v1 不做 serial”
  的决策记录；0024 仍写 serial）。
- **disposition**：operator 决定 retire（无 serial 产品路径；多 target 恒 parallel）
  或 implement（显式 mode + priorResponses）。
- **F044 resolution（2026-11-27）**：D3 选择 implement。routeSerial 已实现并保留
  单 target 前后处理；多 target operator message 仍走 routeParallel，serial 的
  `priorResponses` 有专项测试。

### R5 · 组件 API / deps / 方法

- **0007**：QueueProcessorDeps/methods、InvocationRecordStore methods、
  InvocationTracker signatures 见 0007 §3.2-§3.4。
- **as-built**：见 0019 §3；差异包括 `dispatchTarget`/`capacity`/`multiMention*` deps、
  `drain(threadId,userId,{maxEntries})`/`drainAll`/`requestRetry`/`abandon`、
  `InvocationRecordStore.create/byThreadSource/admitRetry`、`startAll` 的 slot_busy 返回等。
- **classification**：**implementation drift**；无行为 bug，但 target API 没有实现。
- **disposition**：0019 是实际 API；若需要 0007 的接口，补实现或在 0007 标 target-only。

### R6 · 数据模型差异

- **as-built**：`response_drafts.rich_blocks_json`（F031）；`invocation_records`
  `UNIQUE(thread_id, source_record_id)`（0018 R-01）；`owner_json/from_json`
  `json_type='object'` 收紧。
- **classification**：**ratified / minor implementation tightening**。F031 有 feature +
  plan + PR；R-01 有 0018 + decision packet；json_type 是校验收紧，无行为偏离。
- **disposition**：已写入 0019；0007 的 SQL 已修正 rich_blocks_json 与 unique。

### R7 · 工具 / F031 / F043

- **as-built**：4 个 A2A tool + 独立 `superagentteam_create_rich_block`（F031）；
  F043 的 multi-mention 并发、trigger snapshot、`multi_mention_auto_delivery`、
  提问“自动汇总”提示。
- **classification**：**ratified addition**。F031 有 feature/plan/PR；F043 有 operator
  指令、PR #235、daemon 520 tests、live 3005/3014 证据（multi-mention 并发
  +2.82/+3.00/+3.66s；C probe 在 D 60s turn 内完成）。
- **disposition**：保留在 0019。F045 已把 context 部分的 trigger snapshot /
  `upToSeq` / `includeSourceMessageId` 写入 0007 §3.5.1/§6/§9.1 并有 route-first E2E；
  multi-mention 并发与 auto-delivery 归 F046。

### R8 · 读模型 / preflight / 验收

- **MessageDispatchSummary**：**ratified deferred**（F016c S0 freeze：F018 未落地，
  改由 F016c S0 交付；M1 用 queue+live，summary 路由留 M2/后续）。0019 记录为 deferred。
- **preflight invalid reasons**：0007/0010 要求 `session_workspace_changed` /
  `workspace_unavailable`；实际 preflight 只分类 `agent_not_found`/`agent_disabled`/
  `account_not_found`；`sessions.ensureActive` 抛 `session_workspace_changed` 时
  preflight 没有 typed 分类。**classification: code gap → fixed**（`743a94237`）：
  preflight 现在把这两个 reason 归为 invalid target，走 Phase A 的
  `failed(target_invalid)` + typed `delivery_failure` + retire；回归见
  `packages/superagentteam-daemon/test/f018-r2a-dispatch.test.ts`
  “session workspace drift is a terminal target_invalid, not an endless defer”。
- **Known fragility（P3-a，#240 review）**：`invalidSessionReason` 以 error.message
  精确字符串匹配；`ensureActive` 另有 3 个 reject（`session_thread_not_found`/
  `session_user_not_thread_owner`/`session_workspace_not_thread_project`）当前在
  preflight 路径不可达，但未来出现非 owner drain 时会逃逸成零退避循环。F048 记录
  typed session error 的后续方向；当前不阻塞。
- **§9.1 routeAgents 验收**：target-only；实际验收应按 0019 §3.2 的 QueueProcessor
  行为重写。**disposition: doc rewrite**。

### R9 · 命名

- `InvocationRegistry` → `InvocationCredentialStore`；
- `PerAgentTerminalDispositionCollector` → `collectTerminalDispositions` 函数；
- `runAgentTurn` → `RunAgentTurn`；
- `RouteInput`/`PreparedTarget`/`AgentTurnResult` → `PreparedDispatch`/
  `DispatchTargetPort`/void；
- `InvocationQueue` → `QueueLedgerStore`（服务与 store 合并；B9/F047）；
- `MultiMentionStatusReader` → `MultiMentionStore.statusView`（F8/F046）；
- `MessageDispatchSummary` → deferred（R8）。
- **classification**：naming；doc-only。

**F047 disposition（2026-11-28）**

- **B3 `InvocationRecordStore`**：0007 §3.3 的 `createQueued/getBySource/
  listByThread/listBySource/listRunning/requestRetry` 是 target 方法面；as-built 为
  `create/byThreadSource/markRunning/setTerminal/applyTerminalAggregate/admitRetry/get`。
  语义映射：createQueued→create、getBySource→byThreadSource、requestRetry→
  QueueProcessor.requestRetry + admitRetry；其余查询用 thread/status 直接过滤。
  0007 §3.3 标 target-only，live API 以 0019 §3 为准，不新增第二套方法。
- **B6/B7**：`PerAgentTerminalDispositionCollector` → `collectTerminalDispositions`
  函数；`InvocationRegistry` → `InvocationCredentialStore`。能力保留，命名按上表。
- **B9 `InvocationQueue`/`QueueLedgerStore`**：v1 **intentional merge（store-as-service）**。
  `QueueLedgerStore` 拥有 admission/claim/retire/release 的持久化与 CAS 边界；
  `QueueProcessor` 拥有候选选择、Phase A/B 编排与 T3。测试边界
  `f018-queue-ledger.test.ts` + `f018-r2a-dispatch.test.ts`；不拆薄 facade，避免第二套
  claim 语义。
- **F1–F4**：`runAgentTurn`/`RunAgentTurn`、`RouteInput`/`PreparedDispatch`、
  `AgentTurnResult`、collector 函数均为显式映射；没有缺失能力。
- **F8（F046）**：`MultiMentionStatusReader` → `MultiMentionStore.statusView`
  （request + responses + allFailed + callback）；aggregate message `extra.multiMention`
  与 callback row 是同一投影源。callback 的 `queueEntryId` 在 queue row 删除后由
  `ON DELETE SET NULL` 置空，parent/turn 字段保留投递证据。

## 8. 整改计划 / 决策点

> **2026-11-27 operator 决定**：不再 ratify 当前调度，也不在 F043 补丁上继续修；
> 按 0007 的 Clowder 整体设计恢复 route 层。执行计划见
> [`docs/plans/0050-a2a-runtime-alignment.md`](../plans/0050-a2a-runtime-alignment.md)；
> feature 拆分 F044–F051。以下 A/B 选项保留为决策历史。

### D1（已决定 2026-11-27，F044 已实现）· route 层：ratify 还是补实现

**Decision: Option B — 恢复 route 层**。`AgentRouter`/`routeAgents`/`routeParallel`/
`routeSerial`/`priorResponses`/`RouteResponseCommitter` 按 0007 实现；Phase B/T1
回到 `runAgentTurn`，T2 由 route 拥有，T3 留 `QueueProcessor`。Option A 不采用。

**Option A · ratify 当前调度（推荐用于 v1）**

- 保留 `QueueProcessor` 作为 scheduler，`RunAgentTurn` 作为 `DispatchTargetPort`；
  明确 retire `AgentRouter`/`routeAgents`/`routeParallel`/`routeSerial`/
  `priorResponses` 的 v1 运行时角色。
- 理由/证据：R2-a `30af728fc` 已把 Phase A/B + dispatch port 放进 QueueProcessor；
  R2-b `9624eba0b` 把 RunAgentTurn 定为 dispatch port；R2-c `d933afa2a` 把 T2 放进
  RunAgentTurn；F043 PR #235 的并发 fan-out / trigger snapshot / auto-delivery 已在
  live 3005/3014 验证（multi-mention 三个 turn +2.82/+3.00/+3.66s；C probe 在 D 60s
  turn 内完成）。再套 route 层会重复 claim/Phase A/B/T3 ownership，增加第二套
  settlement 路径和 live 风险。
- 代价：与 0001/0002/0004/0005 的“复用 Clowder 1-6/8-10，只替换 invokeSingleCat”
  硬规则不一致；需要 operator 明确 signoff，并更新这些文档与 0007/0016/0024。
- 风险：未来要做 `routeSerial`/worklist 或 Clowder 的结构对齐时，需要重新引入
  route 层；届时应作为独立 feature，不是 live hotfix。

**Option B · 补薄 route 层**

- 在 `DispatchTargetPort` 外包一层 `routeAgents(mode)`：`routeParallel` = 并发
  dispatch + per-target 错误隔离；`routeSerial` = 顺序 dispatch + `priorResponses`；
  T2 移到 route wrapper；Phase B 按 0024 保持 QueueProcessor（或按 0007 移到
  runAgentTurn）。
- 理由：恢复 0001/0002/0004/0005/0016 的硬规则；为未来 serial/worklist 留结构位。
- 代价/风险：中等重构；要重跑 T1/T2/T3 全矩阵、F043 并发/快照、live 重部署；
  当前 F043 的 queue-processor fan-out 要迁移/复用，不能出现双 scheduler。
- 证据基线：0001 §4、0002（pi runtime 段）、0016 §5.6、0024 R2-a/R2-c。

**历史建议（已被 2026-11-27 operator 决定取代）**：当时建议 v1 选 A；
operator 现决定选 B，按 0007 恢复 route 层。

### D2（已决定 2026-11-27，F044 已实现）· T2 / Phase B ownership

**Decision**：按 0007——Phase B/T1 在 `runAgentTurn`/`invokeSingleAgent`；T2 在
route/`RouteResponseCommitter`；T3 在 `QueueProcessor`。不再保留 QueueProcessor/
RunAgentTurn 的 T2 写路径。

- 若选 A：T2 留在 `RunAgentTurn.dispatch`，Phase B 留在 QueueProcessor；更新
  0016/0024 的 owner 表，0019 作为实际 API。
- 若选 B：T2 移到 route wrapper；Phase B 按 0007 或 0024 二选一并写死，不再两处矛盾。

### D3（已决定 2026-11-27，F044 已实现）· routeSerial / priorResponses

**Decision: 实现 routeSerial，不 retire**。即使退化为一个 target，也必须保留
worklist、context、T2、A2A successor、cleanup 等前后处理；multi-target 的
`priorResponses` 按 0007 实现。见 F044。

- **历史建议（已被 2026-11-27 operator 决定取代）**：当时建议 v1 retire；
  operator 现决定实现 routeSerial（单 target 仍保留前后处理）。

### D4 · 独立代码整改（不依赖 D1）· done

**preflight workspace/session typed invalid**：`QueueProcessor.preflight` 调
`sessions.ensureActive` 时没有捕获 `session_workspace_changed`（`session/store.ts`
会抛）；应把它和 `workspace_unavailable` 归类为 invalid target，终态化 + typed
`delivery_failure`，不能让它逃出 `processEntry` 变成 loop error。补回归测试。

**已修复 `743a94237`**：`preflight` 捕获这两个 reason 并归为 invalid target；
Phase A 写 attempt `failed(target_invalid)`、`delivery_failure` 并 retire target。
回归用例在 `packages/superagentteam-daemon/test/f018-r2a-dispatch.test.ts`，
daemon 521 passed / 1 skipped。

### D5 · 文档 / 验收

- 0007 标 `target-design` + banner；0019 为当前真相；F044 cutover 后更新 0019。
- 0007 §9.1/§9.2/§9.3 的验收随 F044/F047/F050 收口；不再按 QueueProcessor inline 行为
  反向改写 target。
- `MessageDispatchSummary` 保持 deferred（F016c S0）；需要时再立 feature。

### D6 · 流程防复发

- Phase 收口 / quality-gate 增加 “architecture as-built delta”：本次触及的组件必须在
  架构文档有 as-built 描述或明确 target-only 标记；PR 模板加 checkbox。
- 架构文档加 status legend：`target-design` / `as-built` / `deferred`；禁止 `accepted`
  同时承载未实现的 target 和已实现行为。
- 每个 phase close 记录“设计 vs as-built”差异，不能只在 commit body 里写。
- 由 F050 落地；feature 文档强制先读 0007/0019/audit 并回链计划 0050。

## 9. 证据索引

### 文档

- 硬规则：`0001-codeteam-architecture-v1.md` §4；`0002-pi-runtime-integration.md`；
  `0004-w5-w8-scale-product.md`；`0005-plan-review-resolutions.md`；
  `0016-turn-terminal-and-settlement-design.md` §5.6；`0021`/`0024`。
- `MessageDispatchSummary` deferred：`docs/reports/2026-11-21-f016c-m1-s0-freeze.md` §1.5。
- R-01 unique：`docs/architecture/0018-v1-global-design-review.md` §4；
  `docs/architecture/decision-packets/2026-11-14-dp-f018-global-review.md`。
- F031：`docs/features/F031-rich-block-producer.md`、`docs/plans/0036-f031-rich-block-producer.md`。
- F043：`docs/features/F043-a2a-parallel-dispatch.md`、`docs/reports/2026-11-27-a2a-parallel-investigation.md`、
  PR #235（merged `f51d9f3c7`）；live 3005/3014。
- 逐项偏移：`docs/reports/2026-11-27-0007-as-built-audit.md`。
- 组件齐全性/命名映射：`docs/reports/2026-11-27-0007-component-completeness.md`。
- daemon 目录重设计：`docs/architecture/0020-daemon-module-layout.md`（F051）。

### 关键 commit

- `30af728fc` R2-a：OperatorMessageIngress + QueueProcessor + Phase A/B + dispatch port。
- `9624eba0b` R2-b：RunAgentTurn 作为 DispatchTargetPort。
- `d933afa2a` R2-c：T1/T2/T3/T4；RunAgentTurn 内 T1/T2。
- `f3b0e567f` / `c6cacb2d2` F043：并发 fan-out、trigger snapshot、auto-delivery。
- `23298eeab`：0007 full audit / DDL 修正。

### 测试 / live

- daemon 520 passed / 1 skipped @ `c6cacb2d2`；F043 新增 history snapshot、
  concurrent fan-out、concurrent drain、auto-delivery rejection、deleted trigger 五类用例。
- F043 live：multi-mention A/B/C 同起点，结束 +2.82/+3.00/+3.66s；D 60s turn 期间
  C probe invocation 169ms 后启动并在 D 结束前完成（`1795759696697 < 1795759748270`）。

## 10. 待 operator 决策

1. **D1**：A（ratify QueueProcessor/DispatchTargetPort）还是 B（补薄 route 层）。
2. **D3**：serial/priorResponses retire 还是 implement。
3. **D4**：preflight workspace/session 修复是否现在做（建议做，小改）。

在 D1/D3 决定前，0019 只声明 as-built 真相，不把未批准的 route 缺失写成“已批准设计”。
