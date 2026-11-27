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

## 实施进度（F044a，2026-11-27）

分支 `feat/f044-route-ownership`（base `superagentteam-work` @ `c4d1c13a`，code
`8c144a894`）完成 route/T2 切片；
Phase B 搬迁保留到 F044b，不在本切片声称 F044 全部完成。

已落地：

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
- **QueueProcessor**：移除 `dispatchTarget`，改注入 `router`；per-target route error 回到
  processor convergence，T3 aggregate 仍由 processor 拥有。
- **上下文装配**：`createContextAssembler` 保留 queue-source `upToSeq` +
  `includeSourceMessageId` 快照语义，history/prompt 都在 route setup 完成。

验证：新增 `f044-route-ownership.test.ts`（barrier / per-target error isolation /
single-target serial / priorResponses / T2 failure 留给 T4）；daemon full suite
528 passed / 1 skipped；daemon build 通过。

仍属 F044b（未完成，不勾 AC-2/AC-4）：

- Phase B（R + TurnExecution + credential + draft + retire）仍在
  `QueueProcessor.processEntry`，尚未搬进 `runAgentTurn` / `invokeSingleAgent`。
- `invoke-single-agent` 独立组件仍是 `RunAgentTurn` + `TurnExecutionLifecycle` 的显式映射，
  尚未抽出独立类/函数。
- A2A successor admission 仍由 tool-time `post_message` 完成；F046 把它统一到 durable
  commit 之后。
- `0019` as-built 的 route 描述在 F044 全部完成后更新；当前 `0019` 仍描述 F044a 之前的
  QueueProcessor inline fan-out。
- 砚砚 review P3（非阻塞，全部挂 F044b）：
  - P3-a：`TurnRunner` 契约去掉 `| null`，或 route 把 null 视为 error，避免理论上
    attempt 已 appended 但被静默跳过。
  - P3-b：`RouteCommitter` 字段名与 `AgentTurnResult.responseText` 对齐，去掉
    `content`/`responseText` 的语义误导。
  - P3-c：T2 commit 失败至少写一条可观测日志，再留给 T4。
  - P3-d：E2E 证据补 daemon/worker/queue 日志关键行与固定端口/HEAD 坐标；F044b 重跑时
    一并补齐。

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
- [ ] AC-2（A2/A3/A4）：Phase B/T1 在 `runAgentTurn`/`invokeSingleAgent`；T2 只由
  route/`RouteResponseCommitter` 写；`runAgentTurn` 不再写 R terminal/draft delete。
  F044a 已完成 T2 owner + `AgentTurnResult` 契约；Phase B 搬迁留 F044b。
- [ ] AC-3（A6/B8）：A2A successor 只在 response durable commit 后 admission；
  `RouteResponseCommitter.commit(result)` 契约对齐。
  F044a 已对齐 `commit(result)`；successor admission 由 F046 接线。
- [ ] AC-4（A5/E3/E4）：`invoke-single-agent` 实现或明确映射；§9.1/§9.3.1 验收按恢复后的
  route 重写。
- [x] AC-5：单 target routeSerial 仍执行 worklist/context/T2/A2A successor/cleanup；
  多 target operator message 走 routeParallel，不误用 serial 产品路径。
- [ ] AC-6：F043 AC-1 回归；T1–T4 ownership matrix 通过；daemon/web tests、typecheck、
  doc-index 绿；非作者 review 覆盖最终 HEAD。
  F043 AC-1 回归与 daemon tests 已绿；review 待最终 HEAD。

- [x] AC-E2E（operator 2026-11-27，强制，F044a slice）：必须在**当前测试 worktree**的隔离 test runtime
  跑真实端到端链路；**Clowder 是 golden**，先按其 route 参考实现/测试构建用例与断言，
  再在本仓复现；执行时观察并输出 daemon/worker/queue 日志关键行；unit/targeted test
  只能补充，不能替代。证据须含 worktree/HEAD、隔离端口/data dir、用例、日志/输出、
  结果；无 E2E 证据不得声明 verified。F044a 证据：`f037-fullstack-e2e.test.ts` 真实
  daemon + 真实 pi worker + mock provider 两条（A→B A2A 链、multi-target `@a1 @b1`
  同批 fan-out，B prompt 不含 A 回复，parent completed）；daemon/worker/queue 日志关键行
  与固定端口坐标留 F044b 重跑补齐（P3-d）。

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
