---
feature_ids: [superagentteam/F044]
related_features: [superagentteam/F018, superagentteam/F043, superagentteam/F045, superagentteam/F046, superagentteam/F047, superagentteam/F048, superagentteam/F050]
title: "F044: A2A route & execution ownership"
status: in-progress
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: []
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-27
updated: 2026-11-27
source_decision: "operator 2026-11-27: 纠正所有 0007↔当前实现偏移；F043 不是设计轴；恢复 route 层与 T1/T2/T3 ownership"
---

# F044: A2A route & execution ownership

> **先读（强制）**：
> - [`0007-a2a-runtime-chain.md`](../architecture/0007-a2a-runtime-chain.md)：target contract。
> - [`0019-a2a-runtime-chain-as-built.md`](../architecture/0019-a2a-runtime-chain-as-built.md)：当前 as-built，原 0008 as-built。
> - [`2026-11-27-0007-as-built-audit.md`](../reports/2026-11-27-0007-as-built-audit.md)：A–F 偏移证据。
> - [`0050-a2a-runtime-alignment.md`](../plans/0050-a2a-runtime-alignment.md)：本计划。
>
> 本 feature 只实现计划切片；不得新增与 0007 冲突的第二套调度。

## 覆盖的 audit 偏移

**A1–A8、B1/B2/B8、E3/E4（route/ownership 部分）**：

- A1：`AgentRouter`/`routeAgents`/`routeParallel`/`routeSerial`/`priorResponses` 不存在。
- A2：Phase B 在 QueueProcessor，应回 `runAgentTurn`。
- A3：T2 在 `RunAgentTurn`，应由 route/`RouteResponseCommitter` 拥有。
- A4：`runAgentTurn` 接口是 `dispatch(): Promise<void>`，缺 generator/result 契约。
- A5：`invoke-single-agent` 独立组件缺失，需要实现或明确映射。
- A6：T2 的 A2A successor 语义与 tool-time successor 不一致。
- A7：实际流程缺少 routeAgents/invoke-single-agent。
- A8：缺 routeAgents per-child signal / serial 契约。
- B1/B2：QueueProcessor deps/methods 与 0007 不一致（route 部分）。
- B8：`RouteResponseCommitter.commit` 签名不一致。
- E3/E4：§9.1 routeAgents 验收、§9.3.1 T2 描述需按恢复后的 route 重写。

## 实施进度

### F044a（2026-11-27，已合入 `49658c23d`）

分支 `feat/f044-route-ownership`（base `superagentteam-work` @ `c4d1c13a`，code
`8c144a894`）完成 route/T2 切片。

- `packages/superagentteam-daemon/src/domains/agent/route.ts`：`AgentRouter` /
  `routeAgents(mode)` / `routeParallel` / `routeSerial` / `AgentTurnResult` /
  `AgentTurnCompletion`。
- **Parallel barrier**：`routeParallel` 先同步完成所有 target 的 history snapshot + prompt
  装配，再启动任何 `TurnRunner`；单个 target 装配失败只产生 per-target error，不阻止
  healthy sibling。
- **Single-target routeSerial**：即使只有一个 target，也走 assemble → run → T2 commit →
  carrier release；serial 多 target 时后续 target 在 prompt 中收到 `priorResponses`。
- **T2 单写者**：`RunAgentTurn` 改为 `TurnRunner`，接收 route 提供的 `TurnContext`，
  返回 `AgentTurnCompletion`；不再构造/调用 `RouteResponseCommitter`。route 在 T2 commit
  后才 `release()` carrier（0007 §3.5 step 11 → step 14）。
- **QueueProcessor**：移除 `dispatchTarget`，改注入 `router`；T3 aggregate 仍由 processor
  拥有。

验证：`f044-route-ownership.test.ts`（barrier / per-target error isolation /
single-target serial / priorResponses / T2 failure 留给 T4）；daemon full suite
528 passed / 1 skipped；daemon build 通过；full-stack E2E 2 passed。

### F044b（2026-11-27，本切片）

分支 `feat/f044b-phase-b`（base `superagentteam-work` @ `49658c23d`）。

- **Phase B owner 搬迁**：新增
  `packages/superagentteam-daemon/src/domains/agent/invoke-single-agent.ts`。
  `InvokeSingleAgent.begin(prepared)` 在一个事务内完成 processing R +
  `TurnExecution.createRunning` + `bindAppended` + credential + draft + input
  dispatchRef + `retireTargets`。`RunAgentTurn.run` 在任何 provider 工作前调用它；
  QueueProcessor 不再写 Phase B。
- **Phase B 失败 typed**：attempt `starting→failed`（terminalReason `phase_b_failed`）+
  step-specific `delivery_failure` reason，target 保持 pending；抛出 `PhaseBError`，
  processor 不再把已处理失败送去 provider convergence。共享
  `recordPrestartFailure` 同时服务 route 装配失败与 Phase B 失败清理。
- **QueueProcessor 只剩 Phase A/tracker/T3 + provider-phase convergence**：
  不再写 R/TurnExecution/credential/draft；`dispatched` 由
  `invocation_attempts.turn_execution_id` store truth 派生；route 错误按
  “有无 Phase B 提交”分流。
- **P3-a**：`TurnRunner.run` 契约去掉 `| null`；route 对 null 返回
  `turn_runner_returned_null` typed error。
- **P3-b**：`RouteResponseCommitter.commit` 输入从 `content` 改为 `responseText`，
  与 `AgentTurnResult` 对齐。
- **P3-c**：route T2 失败写 `route_t2_commit_failed` 结构化日志；daemon 把
  `A2ALog` 接到本地 JSONL。
- **P3-d**：E2E 现在输出并断言关键日志行（`phase_b_appended`、
  `turn_worker_bound`、`turn_terminal`），带 worktree/cwd、隔离 dataDir、实际端口；
  `turn_worker_bound` 携带真实 pi session id + spawn duration，证明真实 worker。
- **测试**：新增 `f044b-phase-b-ownership.test.ts`（Phase B 全链、Phase B 失败不
  二次收敛、route 装配失败、Phase B 失败重试 attempt 2、P3-a、P3-c）；
  `f018-r2c-settlement.test.ts` 增加 P3-b fallback 用例。daemon full suite
  535 passed / 1 skipped；daemon build 通过；full-stack E2E 2 passed。

仍属后续 feature（F044 本切片不声称全部完成）：

- AC-3：A2A successor admission 仍由 tool-time `post_message` 完成；F046 把它统一到
  durable commit 之后。
- 0019 as-built 已更新到 F044b 状态；F047 继续统一 API/DDL/命名表述。

## Why

0007 的整体设计是 `QueueProcessor → AgentRouter → routeParallel/routeSerial →
runAgentTurn → RouteResponseCommitter → T3`。当前实现把 Phase B/T2 折叠进
`QueueProcessor`/`RunAgentTurn`，F043 又在折叠实现上补了并发和快照。operator 2026-11-27
明确：这属于 architecture drift，必须回到 0007 的整体 ownership，而不是继续补丁。

Clowder 的并行 route 在批次边界先完成所有 target 的 context 装配，再启动任何
provider invocation；因此同批 target 不会看到彼此回答。`routeSerial` 即使只有一个
target，也保留 worklist、context、T2、A2A successor、cleanup。

## 用户结果

- multi-target 从同一触发边界开始，任何 target 都看不到同批 sibling 的回答。
- 单 target operator/A2A hop 仍经过 routeSerial 的前后处理，A2A successor 只在
  response durable 后 admission。
- T2 由 route/`RouteResponseCommitter` 统一提交；不再由 `RunAgentTurn` 或
  QueueProcessor 双写。
- F043 AC-1 在 holistic 实现下继续成立。

## 范围

- 新增 `AgentRouter` / `routeAgents(mode)`，作为 QueueProcessor 与 per-target
  execution 之间的唯一 route。
- `routeParallel`：批次 setup 阶段完成所有 target context 装配；再启动 streams；
  per-target 错误隔离；T2 commit 由 route 调用。
  - Parallel barrier 的 **route 结构**归本 feature；`upToSeq`/`includeSourceMessageId`
    等 history/source 语义归 F045。
- `routeSerial`：单 target operator/A2A hop 的 route；即使只有一个 target 也保留
  worklist、context、T2、A2A successor、cleanup。多 target operator message 恒走
  `routeParallel`；`priorResponses` 按 0007 实现。
- `RouteResponseCommitter`：T2 owner；`commit(result)` 契约按 route 结果对齐。
- Phase B/T1 ownership 按 0007：Phase B + T1 在 `runAgentTurn`/`invokeSingleAgent`；
  QueueProcessor 保留 Phase A/T3。
- 删除 `QueueProcessor.processEntry` 的 inline fan-out 与 `RunAgentTurn` 内的 T2 写路径。
- QueueProcessor deps/methods 的 route 部分按 0007 恢复（B1/B2）。

## 非目标

- 不改 history/source message 语义（F045）。
- 不改 multi-mention orchestrator/工具面（F046）。
- 不改 DDL/命名/API 文档（F047）。
- 不改 daemon 并发 drain/tracker 抢占（F048）。
- 不改前端消息表面（F049）。

## 验收

- [x] AC-1（A1/A7/A8）：`AgentRouter`/`routeAgents` 存在；routeParallel 先完成同批全部
  target context 装配，再启动任何 invocation；per-target signal/错误隔离。
- [x] AC-2（A2/A3/A4）：Phase B/T1 在 `runAgentTurn`/`invokeSingleAgent`；T2 只由
  route/`RouteResponseCommitter` 写；`runAgentTurn` 不再写 R terminal/draft delete。
  F044a 完成 T2 owner + result 契约；F044b 完成 Phase B 搬迁与 invoke-single-agent。
- [ ] AC-3（A6/B8）：A2A successor 只在 response durable commit 后 admission；
  `RouteResponseCommitter.commit({turnExecutionId, responseText?})` 契约已对齐；
  successor admission 由 F046 接线。
- [x] AC-4（A5/E3/E4）：`invoke-single-agent` 已实现（Phase B owner），余下差异
  （非 generator、无独立 mergeStreams、commit 输入形状）在 0019/0007 §0.1 明确映射；
  §9.1/§9.3.1 验收按恢复后的 route 重写。
- [x] AC-5：单 target routeSerial 仍执行 worklist/context/T2/A2A successor/cleanup；
  多 target operator message 走 routeParallel，不误用 serial 产品路径。
- [ ] AC-6：F043 AC-1 回归；T1–T4 ownership matrix 通过；daemon/web tests、typecheck、
  doc-index 绿；非作者 review 覆盖最终 HEAD。
  F043 AC-1 回归、daemon tests、typecheck、full-stack E2E 已绿；非作者 review 待最终 HEAD。

- [x] AC-E2E（operator 2026-11-27，强制，F044a slice）：必须在**当前测试 worktree**的隔离 test runtime
  跑真实端到端链路；**Clowder 是 golden**，先按其 route 参考实现/测试构建用例与断言，
  再在本仓复现；执行时观察并输出 daemon/worker/queue 日志关键行；unit/targeted test
  只能补充，不能替代。证据须含 worktree/HEAD、隔离端口/data dir、用例、日志/输出、
  结果；无 E2E 证据不得声明 verified。F044a/F044b 证据：`f037-fullstack-e2e.test.ts`
  真实 daemon + 真实 pi worker + mock provider 两条（A→B A2A 链、multi-target
  `@a1 @b1` 同批 fan-out，B prompt 不含 A 回复，parent completed）。F044b 重跑补齐
  P3-d：测试输出 worktree cwd、隔离 dataDir、实际 base URL，以及
  `phase_b_appended` / `turn_worker_bound`（真实 pi session id + spawn duration）/
  `turn_terminal` 日志行；断言每个 target 都有 Phase B 与 T1 日志。

## 证据

- **Clowder 参考路径**（相对参考仓根目录）：
  - `packages/api/src/domains/cats/services/agents/routing/AgentRouter.ts`
  - `.../routing/route-parallel.ts`（setup barrier/mergeStreams/错误隔离）
  - `.../routing/route-serial.ts`（priorResponses/worklist/单 target 前后处理）
  - `.../routing/commit-completed-response.ts`（T2 + A2A successor）
  - `.../routing/response-terminal.ts`
  - `.../invocation/invoke-single-cat.ts`（per-agent composition/T1）
  - `.../invocation/stream-merge.ts`
- 0007 §0/§2/§3.2/§3.5/§3.6/§3.9/§9.1/§9.3.1。
- 0019 §3/§5/§7/§8、audit A1–A8/B1/B2/B8/E3/E4。
- `docs/reuse/dispatch.md`：R0 直接复用契约；P1 风险明确“只复用 Queue、重写
  routeSerial/routeParallel 会丢掉 A2A chain/worklist/response 聚合”。
- Clowder 参考实现的 route-parallel setup barrier、route-serial worklist/commit
  （本地只读参考，不写进产品路径）。

## 风险 / 回滚

- 核心执行路径重构；分支内完成 parity，不 live 半切。
- T2 ownership 迁移最易双写/漏写；F044 单独矩阵验证，禁止保留旧 T2 写路径。
- 回滚：revert feature 分支；不破坏 schema；live 切换需 operator 授权。

[宪宪/deepseek-flash🐾]
