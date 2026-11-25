---
title: "F034 execution plan — bounded retries + cancel running agent"
doc_kind: plan
status: done
created: 2026-11-25
updated: 2026-11-25
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: [砚砚 (GLM 5.3 Flash), 墨墨 (Qwen 3.8 Flash)]
feature: F034
related_features: [superagentteam/F018, superagentteam/F033]
related: [features/F034-agent-run-control.md, architecture/0007-a2a-runtime-chain.md, architecture/0016-turn-terminal-and-settlement-design.md]
source_decision: "operator 2026-11-25: retry storm + stop running agent"
---

# F034 execution plan

## 1. Retry cap

- `QueueProcessor` provider-phase failure path: compute `attemptNumber` from `attempts.get(attemptId)` and `retryEpoch = records.get(invocationId)?.retryCount ?? 0`; budget = `(retryEpoch + 1) * 5`.
- If `attemptNumber >= budget`: converge failed with `provider_retry_exhausted`, settle attempt, update R failed, **skip `restoreTargets` and `deferrals.defer`**; append a system message with retry/manual-retry guidance.
- Manual `requestRetry` already increments `retry_count`; next attempt number > previous budget, so a fresh 5-attempt window opens. Add tests for both.

## 2. Cancel running

- Add `signal: AbortSignal` to `PreparedDispatch`; processor passes `tracker.getController(threadId, agentId)?.signal`.
- `RunAgentTurn` passes signal to `promptAndWait`; on abort or `{aborted:true}` throws a typed canceled error; attach an abort listener that calls `connection.finish("operator-canceled")` to force worker exit; `finally` releases the worker.
- Processor catch: if signal aborted, terminalize turn/attempt/credential/R canceled with `operator_canceled`; do not restore target; no deferral. Parent aggregate handles all-canceled.
- API: `POST /api/threads/:threadId/agents/:agentId/cancel` with CSRF + thread ownership; `tracker.cancel` false → 409 `not_running`; true → 202 `canceling`; publish queue/live change.
- Web: `a2aApi.cancelAgent`, store action; stop control in `LivePill` / `QueueStrip`; show notice; refresh on `live`/`queue` events.

## 进展（2026-11-25）

- `MAX_PROVIDER_ATTEMPTS=5`；provider failure 的 retry epoch 由 `providerRetryStart` map（invocationId+agentId）记录；`requestRetry` 设置新 epoch，耗尽/取消时清理。
- provider failure 分支现在按 `canceled` / `retryExhausted` / normal 三分支收敛：canceled → `operator_canceled`，不 restore；exhausted → `provider_retry_exhausted` + system message，不 restore；normal 保持原 restore+defer。
- `PreparedDispatch.signal` 从 tracker controller 注入；`RunAgentTurn` 传 signal 给 `promptAndWait`，abort 时 `finish("operator-canceled")` 强制退出 worker，finally 释放。
- cancel API：`POST /api/threads/:threadId/agents/:agentId/cancel`，CSRF + owner gate + `not_running` 409；web `cancelAgent` + LivePill `停止` + QueueStrip cap 说明。
- 测试：daemon 492 passed / 1 skipped；web 101 passed。

## 3. Queue clarity

- Keep `QUEUE_CAP_PER_KIND = 5`; add a title/aria note “每个 thread 每种 kind 最多 5 条（v1 固定）”; no behavior change.

## 4. Verification

- Unit: retry cap, manual retry budget reset, cancel terminalization, tracker signal propagation, API CSRF/409.
- Integration: fake dispatchTarget waits on signal; cancel from tracker; assert canceled truth and no queue target.
- Real: send a message from 3005, stop while running; assert UI shows canceled and worker released.
- Full: daemon/web tests + `npm run check` via CI.

## Risks

- Cancel/completion race: tracker.cancel returns false if the slot was released; API returns 409 and UI treats as already finished.
- Multi-target parent: one target canceled, siblings continue; parent `partial_failed`/`canceled` follows existing collector semantics.
- Worker abort reliability: `finish("operator-canceled")` is the hard stop; signal alone may be advisory.

[宪宪/deepseek-flash🐾]
