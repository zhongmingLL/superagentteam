---
title: "0007 component completeness check — daemon"
doc_kind: report
status: done
created: 2026-11-27
updated: 2026-11-27
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
---

# 0007 component completeness check

## 目的

回答 operator「007 的各组件是否齐全、偏移点是否都识别到了」。以 0007 §3 的组件表
为底稿，逐项对照 `packages/superagentteam-daemon/src`，标出
**present / mapped / missing / aligned（v1 不做）**，并补上 audit A–F 没列出的
命名/服务映射漂移。

## 结论

- 0007 的核心组件**大部分存在**：Ingress、Message/Thread/Session store、Queue ledger、
  InvocationRecord/Attempt/Turn store、Tracker、WorkerPool、History、Draft、Credential、
  A2A tools、MultiMention、T1/T3/T4、recovery、live read model 都能在代码中找到。
- **真正缺失的组件/能力**只有三类：
  1. route 层：`AgentRouter`/`routeAgents`/`routeParallel`/`routeSerial`/
     `priorResponses`/`mergeStreams`；
  2. `invoke-single-agent` 独立组件；
  3. `MessageDispatchSummary` 读模型。
- 其余是 **owner/API/DDL/命名**漂移：T2 位置、`runAgentTurn` 接口、QueueProcessor/
  InvocationRecordStore/Tracker 方法面、`InvocationQueue` 与 `QueueLedgerStore` 合并、
  `InvocationRegistry`/`InvocationCredentialStore`、`PerAgentTerminalDispositionCollector`/
  collector function、`MultiMentionStatusReader`/`statusView`。
- **“不是能力缺失”不等于“不整改”**：F047 的判据是 public contract 改代码、DDL/验收
  改文档、纯命名显式映射；每项都要有 disposition，见 F047「整改策略」。
- 本轮新增识别：**B9 `InvocationQueue` 服务与 store 合并**、**F9
  `MultiMentionStatusReader` 命名/接口映射**。audit A–F 其余项已覆盖。

## 组件清单

| # | 0007 组件 | 0007 § | 代码位置 | 状态 | audit / feature |
|---|---|---|---|---|---|
| 1 | `OperatorMessageIngress` | §3.0 | `domains/a2a/router.ts` | present | aligned |
| 2 | `MessageStore` | §3.1.1 | `domains/message/store.ts` | present | aligned (D9) |
| 3 | `InvocationQueue` | §3.1 | `domains/queue/store.ts`（`QueueLedgerStore` 合并） | mapped / service-store combined | **B9** / F047 |
| 4 | `QueueLedgerStore` | §3.1 | `domains/queue/store.ts` | present | aligned |
| 5 | `QueueProcessor` | §3.2 | `domains/queue/processor.ts` | present / API drift | B1/B2 / F044/F048 |
| 6 | `InvocationRecordStore` | §3.3 | `domains/invocation/store.ts` | present / API drift | B3 / F047 |
| 7 | `InvocationTracker` | §3.4 | `domains/queue/tracker.ts` | present / API drift | B4/B5 / F048 |
| 8 | `InvocationOwnerReaper` | §3.4 | `domains/invocation/recovery.ts` | present | aligned |
| 9 | `AgentRouter` | §3.5 | — | **missing** | A1 / F044 |
| 10 | `routeAgents` | §3.5 | — | **missing** | A1 / F044 |
| 11 | `routeParallel` | §3.5 | — | **missing** | A1 / F044 |
| 12 | `routeSerial` | §3.5 | — | **missing** | A1 / F044 |
| 13 | `priorResponses` / `mergeStreams` | §3.5 | — | **missing** | A1 / F044 |
| 14 | `runAgentTurn` | §3.5 | `RunAgentTurn`（`domains/agent/turn.ts`） | mapped / API drift | A4 / F044 |
| 15 | `RouteInput` / `PreparedTarget` / `AgentTurnResult` | §3.5 | —（有 `PreparedDispatch`） | mapped / missing contract | A4/F4 / F044/F047 |
| 16 | `RouteResponseCommitter` | §3.5 | `domains/invocation/settlement.ts` | present / wrong owner+signature | A3/B8 / F044 |
| 17 | `HistoryAssembler` | §3.5.1 | `domains/history/assembler.ts` | present | A9 / F045 |
| 18 | `AgentReadStateStore` | §3.5.1 | `domains/message/store.ts` | present | aligned |
| 19 | `WorkerPool` | §3.5.2 | `domains/worker/pool.ts` | present | aligned |
| 20 | `WorkerStore` / `WorkerBindingStore` | §3.5.2 | `domains/worker/store.ts` | present | aligned |
| 21 | `invoke-single-agent` | §3.6 | —（T1 在 `TurnExecutionLifecycle`） | **missing / mapped** | A5 / F044/F047 |
| 22 | `TurnExecutionStore` | §3.6 | `domains/invocation/store.ts` | present | aligned |
| 23 | `TurnExecutionLifecycle`（T1） | §3.6 | `domains/invocation/settlement.ts` | present | aligned |
| 24 | `ResponseDraftStore` | §3.6.1 | `domains/response/store.ts` | present | C1 / F047 |
| 25 | `InvocationRegistry` | §3.7 | `InvocationCredentialStore`（`domains/auth/store.ts`） | mapped / naming | B7 / F047 |
| 26 | `A2AToolService` | §3.8 | `domains/a2a/tool-service.ts` | present | aligned |
| 27 | `ThreadContextService` | §3.8 | `domains/a2a/thread-context.ts` | present | aligned |
| 28 | `MultiMentionOrchestrator` | §3.8 | `domains/multi-mention/orchestrator.ts` | present / needs parity check | A9/D2/D3 / F046 |
| 29 | `MultiMentionStatusReader` | §3.8 | `MultiMentionStore.statusView` | mapped / naming | **F9** / F046/F047 |
| 30 | `PerAgentTerminalDispositionCollector` | §3.9 | `collectTerminalDispositions`（`domains/invocation/collector.ts`） | mapped / naming | B6 / F047 |
| 31 | `transitionTerminal` | §3.9 | `TurnExecutionStore` | present | aligned |
| 32 | `TurnExecutionStartupReconciler` | §3.10 | `domains/invocation/recovery.ts` | present | aligned |
| 33 | `TrajectoryProjector` | §3.10 | — | aligned（v1 不做） | D7 |
| 34 | `LiveInvocations` | §3.10 | `domains/invocation/live.ts` | present | aligned (D8) |
| 35 | `MessageDispatchSummary` | §3.10 | — | **missing / deferred?** | D6/F5 / F046 |
| 36 | `ResponseRecoveryService`（T4） | §3.6/§3.10 | `domains/invocation/settlement.ts` | present | aligned |
| 37 | Queue admission / read models | §3.1/§3.10 | `domains/queue/store.ts` + API routes | present | aligned |
| 38 | rich block producer tool | F031 | `domains/rich-block/tool-surface.ts` | present / undocumented | D1 / F046 |
| 39 | `routing_guard` | §3.6 | —（v1 不创建） | aligned | F6 |
| 40 | `a2a_requests` legacy | §3.8 | —（v1 不写） | aligned | F7 |

## 新增偏移（补入 0050 覆盖矩阵）

### B9 · `InvocationQueue` 服务与 `QueueLedgerStore` 合并

0007 把 `InvocationQueue`（enqueue/claim/retire/release/withdraw/restore）作为服务层，
store 作为持久层；当前 `QueueLedgerStore` 同时承担两者。能力齐全，但 ownership/
测试边界混在一起。处置：F047 决定“拆薄服务层”或“明确 store-as-service 映射”，
不能让 0007 的 `InvocationQueue` 看起来像缺失。

### F9 · `MultiMentionStatusReader` 映射到 `statusView`

0007 §3.8 的 status read 是 `MultiMentionStatusReader.get(requestId)`；当前是
`MultiMentionStore.statusView(requestId)`。能力存在，但接口/命名未记录。处置：
F046 验证 status/read 语义，F047 记录映射或抽 reader。

## 与 audit A–F 的关系

本报告不替代 audit；它补的是「组件是否存在/叫什么」这一层。audit A–F 的 36 行
仍是偏移处置底稿。新增 B9/F9 已补进 0050 覆盖矩阵；其余组件没有发现新的缺失，
只是 owner/API/DDL/命名漂移。

[宪宪/deepseek-flash🐾]
