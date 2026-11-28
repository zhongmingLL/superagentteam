---
title: "0007/0019 second-pass implementation drift audit"
doc_kind: report
status: active
created: 2026-11-28
updated: 2026-11-28
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
source_decision: "operator 2026-11-28: 重新读 0007/0008 文档与当前实现，二次校验设计与实现是否还有偏移"
---

# 0007/0019 second-pass implementation drift audit

## 范围与方法

- **0007**：`docs/architecture/0007-a2a-runtime-chain.md`（target contract/history）。
- **0008 as-built**：operator 所指的 0008 是原
  `0008-a2a-runtime-chain-as-built.md`；因撞号已改名
  [`0019-a2a-runtime-chain-as-built.md`](../architecture/0019-a2a-runtime-chain-as-built.md)。
- 基线：工作区 `superagentteam-work`；runtime `af82e157`；
  代码 HEAD `a24a7dd9a`（F052 docs merge 前，A2A 代码与 `af82e157` 相同）。
- 方法：逐项读 0007 owner/API/DDL/验收 → 对照 0019 → 读当前代码实现 →
  跑 daemon full + route/schema/parity 定向 → 查 runtime SQLite schema/表集合。
- 判定：**code drift**（行为/契约未实现）、**doc drift**（as-built 文档过期）、
  **target-only mapping**（目标 API 名与当前实现显式映射，无行为缺口）、
  **known limitation**（已记录但不阻塞）。

## 结论

**本轮没有发现新的 runtime 语义 code drift。** F044–F048 的 route/Phase B/T1–T4、
F046b successor、F047 DDL、F048 并发/recovery 与 0007 target 的核心行为一致。

真正还存在的偏移是 **as-built 文档过期**：0019/0007 仍保留 F051 前路径、F046b 前
`post_message` 语义、F048 前“并发 drain 待办”、旧 baseline 与已关闭决策。已在本次
审计中修正（见 Findings）。

## Findings

| # | 严重度 | 类型 | 发现 | 处置 |
|---|---|---|---|---|
| S1 | P2 | doc drift | 0019 §1/§3 路径仍是 `domains/a2a/router.ts`、`domains/queue/processor.ts`、`domains/agent/{route,turn,invoke-single-agent}.ts` | 改为 F051b 实际路径：`domains/a2a/ingress/router.ts`、`domains/queue/processor/index.ts`、`domains/a2a/routing/route.ts`、`domains/execution/{turn,invoke-single-agent}.ts` |
| S2 | P2 | doc drift | 0019 §3.5 写 `postMessage targets=1 → message + message_wake`；0007 §9.5 首条也仍写 tool-time 创建 queue/parent，与 F046b 后的实现及下一条 bullet 冲突 | 改为 tool-time message + caller credential `pendingSuccessor`；queue/parent 在 T2/T4 admission |
| S3 | P2 | doc drift | 0007 §0.1/§3.5 的 as-built note 仍写“当前没有 AgentRouter/routeSerial/priorResponses”“successor 仍 tool-time” | 更新为 F044/F046b 后的 as-built，并指向 0019 §3 |
| S4 | P3 | doc drift | 0019 §3.2 仍写“F048 待处理 bounded concurrent drain 精确上限” | F048 已实现 `MAX_ACTIVE_DRAINS=8`（`app/daemon-a2a.ts:23,256-258`） |
| S5 | P3 | doc drift | 0019 §4 仍以 `f51d9f3c7` 为 schema baseline | 更新为 `af82e157` |
| S6 | P3 | doc drift | 0019 §10 仍列 D1/D3/D4 待 operator 决策 | 改为已关闭；D1=B、D3=implement、D4 fixed |
| S7 | P3 | doc gap | 0019 §3.2 preflight 列表漏 `session_workspace_changed` / `workspace_unavailable` | 补入；代码 `INVALID_SESSION_REASONS` 已包含两者 |
| S8 | P3 | target-only mapping | `AgentRouter.resolveTargets`、`routeAgents(): AsyncIterable`、`commit(result)`、`InvocationRegistry`、collector class、`MessageDispatchSummary` | 0019 §7/§9 已记录显式映射；无行为缺口，不新增第二套 API |
| S9 | P3 | target-only mapping | 0007 §3.4 写 tracker 抢占会把旧 TurnExecution 标 `interrupted/preempted`；实际 tracker 只 abort，旧 turn 捕获 signal 后终态为 `canceled` | F048 B5 覆盖无 zombie/新 slot 行为；0007 增加 as-built note，0019 §3.4/§6 记录 owner 映射 |

## 代码核验

- **route 层**：`domains/a2a/routing/route.ts` 存在 `AgentRouter.routeAgents`、
  `routeParallel`（先装配全部 context 再 `Promise.all`）、`routeSerial`（worklist +
  `priorResponses`）、T2 `commit` + carrier release。
- **Phase B/T1**：`domains/execution/invoke-single-agent.ts` 的 `begin()` 单事务写
  processing R + TurnExecution.createRunning + bindAppended + credential + draft +
  input dispatchRef + retireTargets；`domains/execution/turn.ts` 调
  `TurnExecutionLifecycle.invokeTerminal`，T1 仍是 child terminal 唯一写入点。
- **T2/T4**：`domains/invocation/settlement/index.ts` 的
  `RouteResponseCommitter.commit` 处理 R/draft/pending；`settlingTail` 内
  `flushPendingSuccessors` 在同一个 T2 事务里 admission successor；
  `ResponseRecoveryService` 只做 pending/missing R recovery。
- **T3**：`domains/queue/processor/index.ts` 的 `processEntry` 在 `finally`
  调 `aggregateParent`（`domains/invocation/aggregate/aggregate.ts`），不写 child/R。
- **preflight**：`INVALID_SESSION_REASONS` 含 `session_workspace_changed` /
  `workspace_unavailable`；invalid target 走 Phase A typed `delivery_failure` + retire。
- **并发**：`app/daemon-a2a.ts` `MAX_ACTIVE_DRAINS=8`；`tick` 超限返回 null。
- **工具**：`tool-service.ts` F046b 只写 message + pending successor，T2/T4 flush；
  `multi_mention` aggregate/callback/auto-delivery 仍按 F046。
- **DDL**：runtime `response_drafts` 含 `rich_blocks_json`；
  `invocation_records` 为表级 `UNIQUE(thread_id, source_record_id)`；
  runtime 表集合无 task/custody/review/merge/gate/legacy `a2a_requests` 表。

## 验证

- daemon full：**561 passed / 5 skipped**（83 files + 4 skipped）。
- 定向：`f044-route-fullstack-e2e` + `f045-context-history-e2e` +
  `f047-schema-parity` + `f050-parity-guard`：**20/20 passed**。
- `check:daemon-layout`、`check:ts-imports`、`check:entry-graphs`：passed。
- runtime `/health`：`af82e157`；schema/表集合与 0019 修正后的描述一致。

## 仍然存在的已知限制（非新偏移）

- `workspace_unavailable` 是 target-contract 预留名，daemon src 无抛出点；0019/F050
  已标 contract-reserved，不标 verified。
- `invalidSessionReason` 仍按 error.message 精确字符串匹配（P3-a）；F048 已记录
  typed session error 后续方向。
- `routeAgents` 的实际返回是 `RouteResult`，不是 0007 target 的
  `AsyncIterable<AgentStreamEvent>`；stream 仍经 `ResponseEventSink`。这是显式 target-only
  API mapping，无行为缺口。

[宪宪/deepseek-flash🐾]
