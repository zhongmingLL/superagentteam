---
feature_ids: [superagentteam/F045]
related_features: [superagentteam/F018, superagentteam/F043, superagentteam/F044, superagentteam/F046, superagentteam/F050]
title: "F045: A2A context/history parity"
status: planned
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: []
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-27
updated: 2026-11-27
source_decision: "operator 2026-11-27: 纠正所有 0007↔当前实现偏移；history/source message 语义按 0007 + F043 回归重做"
---

# F045: A2A context/history parity

> **先读（强制）**：
> - [`0007-a2a-runtime-chain.md`](../architecture/0007-a2a-runtime-chain.md)：target contract。
> - [`0019-a2a-runtime-chain-as-built.md`](../architecture/0019-a2a-runtime-chain-as-built.md)：当前 as-built，原 0008 as-built。
> - [`2026-11-27-0007-as-built-audit.md`](../reports/2026-11-27-0007-as-built-audit.md)：A–F 偏移证据。
> - [`0050-a2a-runtime-alignment.md`](../plans/0050-a2a-runtime-alignment.md)：本计划。
>
> 本 feature 只实现计划切片；不得用 per-turn 过滤替代 route 层的 context barrier。

## 覆盖的 audit 偏移

**A9（context 部分）**：

- A9：F043 的 trigger snapshot/`upToSeq`/`includeSourceMessageId` 未进入 0007
  §3.5.1/§6/§9，当前靠 per-turn 参数补。

## Why

0007 §3.5.1 的 history 由 delivery cursor 驱动；这不足以处理两种真实场景：

1. 并行 target 在批次边界必须看到同一个触发快照，不能看到同批 sibling 的 response。
2. `post_message` 的源消息 seq 可能低于目标 agent 的 cursor；仅靠 cursor 会得到空窗口。

F043 用 `upToSeq` + `includeSourceMessageId` 修了表面症状，但这两个语义没有进入
0007/0019 的 target/验收。F045 把它们做成 route/context 的正式语义，而不是 per-turn
补丁。

## 用户结果

- 并行 multi-target 的每个 target 从同一触发边界装配 context；先完成的 sibling
  不会出现在其他 target 的 prompt。
- `post_message` 目标在 cursor 已越过源 seq 时仍能读到源消息，不出现“无新消息”空转。

## 范围

- `HistoryAssembler`/`runAgentTurn` context 装配：`upToSeq` 固定在 queue source；
  `includeSourceMessageId` 保证 post_message 源消息进入 prompt。
- Parallel barrier 的 context 部分：所有 target 的 context 在批次边界装配完成后再启动
  invocation（与 F044 route 结构联合）。
- 回归 F043 Q1/Q2 的 context 部分。

## 非目标

- 不改 route/T2 ownership（F044）。
- 不改 multi-mention orchestrator/auto-delivery（F046）。
- 不改 DDL/命名（F047）。
- 不改 daemon 并发（F048）。
- preflight invalid reasons / session reject 分类归 F048，不在本 feature 重复。

## 验收

- [ ] AC-1（A9）：parallel multi-target 从同一触发快照装配 context；一个 target 先完成
  并写入 response 时，sibling 的 prompt 不包含它。
- [ ] AC-2（A9）：`post_message` 目标在 cursor 已越过源 seq 时仍能在 prompt 读到源消息；
  不出现空窗口。
- [ ] AC-3：F043 Q1/Q2 context 部分回归；tests/typecheck/review 绿。

- [ ] AC-E2E（operator 2026-11-27，强制）：必须在**当前测试 worktree**的隔离 test runtime
  跑真实端到端链路；**Clowder 是 golden**，先按其 context/history 参考实现/测试构建
  用例与断言，再在本仓复现；执行时观察并输出 daemon/worker/queue 日志关键行；
  unit/targeted test 只能补充，不能替代。证据须含 worktree/HEAD、隔离端口/data dir、
  用例、日志/输出、结果；无 E2E 证据不得声明 verified。

## 证据

- **Clowder 参考路径**（相对参考仓根目录）：
  - `packages/api/src/domains/cats/services/context/ContextAssembler.ts`
  - `.../routing/route-helpers.ts`（`assembleIncrementalContext` /
    `explicitPromptForIncrementalContext` / `collectExactPromptMessageIds`）
  - `.../stores/message-delivery-boundary.ts`
  - `.../stores/ports/DeliveryCursorStore.ts`
  - `.../invocation/context-continuity.ts`
- 0007 §3.5.1 history/cursor、§9.1 context 验收。
- 0019 §3.5/§7 R8、audit A9。
- `docs/reports/2026-11-27-a2a-parallel-investigation.md`：Q1/Q2 时间线。

## 风险 / 回滚

- Context barrier 可能增加首 token 延迟；测量，但不退回 per-turn 过滤。
- `includeSourceMessageId` 不能让已删除/越权消息重新进入 prompt；保留 deleted/visibility 守卫。
- 回滚：revert feature 分支；不改 schema。

[宪宪/deepseek-flash🐾]
