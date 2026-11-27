---
title: "A2A alignment close-out — audit A–F dispositions"
doc_kind: report
status: active
created: 2026-11-28
updated: 2026-11-28
source_decision: "operator 2026-11-27: 纠正所有 0007↔当前实现偏移；F050 逐行收口 audit A–F"
---

# A2A alignment close-out

本表逐行处置 `docs/reports/2026-11-27-0007-as-built-audit.md` 的 A–F 偏移。
状态定义：**fixed**（代码/行为已改）、**doc-aligned**（0007/0019/验收文档已对齐）、
**no-action**（已核对为 aligned/有意 decision）。

## A. 架构 / ownership

| # | 处置 | 证据 |
|---|---|---|
| A1 | fixed | F044 `AgentRouter/routeAgents/routeParallel/routeSerial/priorResponses`；`f044-route-ownership.test.ts` + fullstack R1 |
| A2 | fixed | F044b Phase B → `InvokeSingleAgent.begin`；`f044b-phase-b-ownership.test.ts` |
| A3 | fixed | T2 由 `RouteResponseCommitter`；F044 AC-6 matrix + settlement tests |
| A4 | fixed | `TurnRunner.run` + `AgentTurnCompletion`；F044 route contract |
| A5 | fixed | `InvokeSingleAgent` 独立组件；F044b |
| A6 | fixed | F046b successor → T2/T4 pending-claim flush；fullstack F046b |
| A7 | fixed | QueueProcessor Phase A → route → T3；F044 fullstack |
| A8 | fixed | per-child signal + serial；F044/F048 fullstack |
| A9 | fixed | F045 trigger snapshot + F046 auto-delivery/prompt；F045/F046 docs/tests |

## B. 组件 API / 依赖

| # | 处置 | 证据 |
|---|---|---|
| B1 | fixed | QueueProcessorDeps 按 route/并发重建；F044/F048 |
| B2 | doc-aligned | QueueProcessor 方法映射表（F048 doc）；`requestDrain/processNext/recoverStartup/onInvocationComplete` 在 daemon/route 组合根 |
| B3 | doc-aligned | 0019 R9 F047 B3 映射；0007 §3.3 target-only |
| B4 | fixed/doc | tracker `cancel/listStaleSlots/cancelAll` 测试；F048 |
| B5 | fixed | preempt 用 turn captured signal；F048 fullstack B5 |
| B6 | doc-aligned | collector function 命名映射；F047 R9 |
| B7 | doc-aligned | InvocationCredentialStore 命名映射；F047 R9 |
| B8 | fixed | `RouteResponseCommitter.commit` 契约；F044 |
| B9 | doc-aligned | 0019 R9 intentional store-as-service merge；F047 |

## C. 数据模型

| # | 处置 | 证据 |
|---|---|---|
| C1 | doc-aligned | 0007 §4.3.2 `rich_blocks_json`；F047 schema parity |
| C2 | doc-aligned | 0007 §4.2 表级 `UNIQUE(thread_id, source_record_id)`，无列级 UNIQUE；F047 schema parity |
| C3 | doc-aligned | `owner_json/from_json` `json_type='object'`；F047 schema parity |
| C4 | doc-aligned | 0007 §4 target/as-built 边界；F047 |
| C5 | no-action | attempts/credential/read state/workers DDL 已核对 aligned |
| C6 | no-action | 同 C5 |

## D. 工具 / 特性

| # | 处置 | 证据 |
|---|---|---|
| D1 | doc-aligned | 0007 §3.8 第五个 presentation-only rich block tool；F046 |
| D2 | fixed/doc | 0007 §3.8 auto-delivery typed reject；F046 fullstack |
| D3 | doc-aligned | 0007 §3.8 multi-mention prompt template；F046 |
| D4 | fixed | preflight session/workspace typed invalid；F048 + f018-r2a |
| D5 | no-action | tool targets/上限/read model 已核对 |
| D6 | doc-aligned | MessageDispatchSummary explicit deferred（0019 R8/F016c S0）；F046 |
| D7–D9 | no-action | 已核对 aligned |

## E. 状态机 / 验收

| # | 处置 | 证据 |
|---|---|---|
| E1 | doc-aligned | §9.2 thread-scoped unique；F047 |
| E2 | fixed | preflight `session_workspace_changed/workspace_unavailable`；F048 |
| E3 | fixed | routeAgents parallel/serial 验收按 F044 重写 |
| E4 | doc-aligned | T2 content/richBlocks 描述；F044/F047 |
| E5 | no-action | auth/recovery/userId invariants 已核对 |

## F. 命名 / 低优先级

| # | 处置 | 证据 |
|---|---|---|
| F1–F4 | doc-aligned | 0019 R9 映射；F047 |
| F5 | doc-aligned | MessageDispatchSummary deferred；F046 |
| F6–F7 | no-action | legacy routing_guard/a2a_requests aligned/no-action；F050 |
| F8 | doc-aligned | MultiMentionStore.statusView；F046 |

## 特别说明

- `workspace_unavailable` 仍是 target-contract 预留名：daemon src 无抛出点、测试零覆盖；
  本报告标 **contract-reserved, no runtime path**，不标 verified。
- F043 AC-4 视觉：代码已 implemented；真实 Hub 1440/390 光暗的 A2A 私有气泡/汇总卡
  截图与 operator 验收仍待 F050 AC-4b，不把 AC-4 标成 live complete。
- runtime 3005/3014 部署需 operator 显式授权；本轮所有证据来自隔离 test runtime。

[宪宪/deepseek-flash🐾]
