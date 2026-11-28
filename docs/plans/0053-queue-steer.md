---
title: "0053: Queue steer implementation plan"
doc_kind: plan
status: active
created: 2026-11-28
updated: 2026-11-28
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
source_decision: "operator 2026-11-28: 实现 steer，先参考 Clowder 的 steer 设计"
---

# 0053: Queue steer implementation plan

## 目标

在现有 `invocation_queue` + `InvocationTracker` + pi worker 上实现单目标 steer：
`guide` 把排队消息注入 exact active turn；`interrupt` 取消该轮并用同一 Queue row
立即启动。Web 提供 Clowder 风格的「处理这条」入口与逐目标策略弹窗。

## 现有契约

- `QueueLedgerStore.claim(threadId, entryId, { targetKeys })`：entry 级短 claim。
- `QueueProcessor.processEntry(entry, claimId, userId)`：claim 内 target 的完整
  Phase A/B 启动；失败会 release claim 并 defer。
- `InvocationTracker`：`(threadId, agentId)` 单 slot；`cancel` abort + 释放 slot。
- `RunAgentTurn`：`pool.ensure()` 后拿 `WorkerHandle.connection`，`promptAndWait`。
- `WorkerRpcConnection`：目前只有 `onEvent/promptAndWait/finish`。
- `coding-agent` RPC：已有 `steer` command，返回 `{ disposition: "handled"|"queued" }`。

## 工作单元

### W1 — Worker steer + registry

1. `RpcConnection.steer(message)` 调用 `{type:"steer"}`，校验 `success`。
2. `WorkerRpcConnection` 增加可选 `steer?`。
3. 新增 `domains/queue/steer/registry.ts`：attach/get/detach，按
   `threadId + agentId` 索引，带 `turnExecutionId`/`attempt`。
4. `RunAgentTurn` 在 `pool.ensure` 后 attach，prompt 结束/异常/取消时 detach。
5. `buildA2ARuntime` 构造 registry，注入 `RunAgentTurn` 与 `SteerService`。

### W2 — SteerService + route

1. `SteerService.steer({ threadId, entryId, targetAgentId, mode, userId })`：
   - entry/status/target 校验 → claim；
   - guide：registry + tracker exact fence → `steer(content)` → dispatchRef →
     `retireTargets`；
   - interrupt：`tracker.cancel` → `queue.setPriority("urgent")` →
     `processor.processEntry`；
   - 所有失败 release claim，返回 typed outcome。
2. `QueueLedgerStore.setPriority`（仅 queued）。
3. `POST /api/threads/:threadId/queue/:entryId/steer`，body
   `{ targetAgentId, mode }`；owner check；409/404/502 typed；成功后 publish
   queue change（若 changeBus 可用）。

### W3 — Web

1. `a2a/api.ts`: `steerQueue(threadId, entryId, targetAgentId, mode)`.
2. `a2a/store.ts`: `steerQueue` action，成功后 refresh snapshot。
3. `QueueStrip`: queued 行「处理这条」；`SteerQueueDialog`（chips + 逐目标策略 +
   顺序提交 + 失败汇总）。
4. `ThreadPage`: 传入 live + steer action；错误显示在 strip 附近。
5. CSS：复用 tokens，补 `.st-queue-steer` / `.st-steer-*`；390 无横向滚动。

### W4 — 测试

1. daemon service tests：
   - guide 成功（steer content、dispatchRef、retire、不 cancel）；
   - guide 无 active（409、claim 释放）；
   - interrupt active（cancel、urgent、processEntry、sibling 保留）；
   - interrupt idle（直接 start）；
   - owner/claimed/target-delivered/RPC failure。
2. fullstack E2E：真实 pi worker + mock Anthropic；guide 让 provider 第二轮看到
   steer 内容；interrupt 取消慢响应并生成新回复。
3. web tests：queued 才有按钮、guide disabled、提交 mode、失败提示。
4. `check:web` + daemon targeted/full + doc-index。

### W5 — 收口

1. 隔离 3007/3016 实机预览（queue 行 + dialog + guide/interrupt）。
2. 非作者 review（砚砚/墨墨），CI 5/5。
3. 合入 + runtime 部署 + F053/BACKLOG/report 更新。

## 验证顺序

1. `npm --prefix packages/superagentteam-daemon test -- f053`（新测试）
2. daemon full
3. `npm --prefix packages/superagentteam-web test`
4. `npm run check:web` + `npm run check:doc-index`
5. fullstack E2E
6. 隔离栈 390/1440 截图

## 回滚

纯新增 registry/service/route + web 控件；回滚 code commit 即可。Queue ledger/DDL
无变更（priority 更新是既有列）。guide 的 dispatchRef 是既有 input lifecycle 扩展，
不回写消息正文。

[宪宪/deepseek-flash🐾]
