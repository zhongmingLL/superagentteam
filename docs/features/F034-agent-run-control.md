---
feature_ids: [superagentteam/F034]
related_features: [superagentteam/F018, superagentteam/F033]
title: "F034: Agent run control — bounded retries + cancel running agent + queue clarity"
status: spec
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: [砚砚 (GLM 5.3 Flash), 墨墨 (Qwen 3.8 Flash)]
created: 2026-11-25
updated: 2026-11-25
source_decision: "operator 2026-11-25: frontend message to agent triggers ~50 retries; queue shows 1/5; can we stop a running agent like Clowder?"
---

# F034: Agent run control

## Why

operator 在前端给 agent 发消息后观察到同一目标持续重试（本地 f018.db 已出现同一 invocation 的 attempt 358，terminal_reason=`provider_phase_failed`，约每 10s 一次），最终才恢复。当前 `RetryDeferrals` 只有指数退避（base 10s / cap 1h），没有自动重试次数上限；失败目标会被无限 restore 到队列。UI 只显示 `1 / 5` 的固定队列上限，没有停止运行中 agent 的入口。

## 用户结果

- 自动重试有明确上限；失败后进入终态并提示“自动重试已耗尽，可手动重试”，不再无限循环。
- 运行中的 agent 可以在前端停止；停止会终止 worker、释放 slot，并把 turn/attempt/R 标为 canceled。
- 队列显示明确说明 `5` 是 per-kind 上限；运行/队列区域提供停止入口。

## 范围

- F034.1 重试预算：每个 manual retry epoch 最多 5 次自动 provider 重试；第 5 次失败后不再 restore target，parent/attempt/R 终态 failed，reason `provider_retry_exhausted`。
- F034.2 手动重试：保留现有 `POST .../invocations/:id/retry`；manual retry 递增 `retry_count`，开启新一轮 5 次自动预算。
- F034.3 停止运行：新增 `POST /api/threads/:threadId/agents/:agentId/cancel`；复用 `InvocationTracker.cancel`，把 AbortSignal 传入 `RunAgentTurn`/worker，并 terminalize turn/attempt/R canceled；不 restore target。
- F034.4 UI：运行中 agent 显示“停止”；QueueStrip 说明 `5` 是 per-kind 上限；停止后 live/queue 更新。
- 测试：retry cap、manual retry 重置、cancel 终态、API CSRF/409、UI 停止按钮。

## 非目标

- 不做可配置队列上限（v1 固定 5，先显示说明；以后单独评估）。
- 不做 provider 特定的错误分类/退避表。
- 不做 daemon 重启后的活动 turn 自动恢复 UI（既有 T4/recovery 边界不变）。

## 验收

- [ ] AC-1：同一目标连续 provider 失败 5 次后不再自动入队；parent failed，reason `provider_retry_exhausted`，用户可见说明。
- [ ] AC-2：手动 retry 后重新获得 5 次预算，且不会复用已终态 attempt。
- [ ] AC-3：停止 API 在 agent 运行时返回 202；turn/attempt/R 变为 canceled，worker 释放，queue target 不 restore。
- [ ] AC-4：前端运行时显示“停止”，点击后状态更新；队列 `1 / 5` 有一行说明。
- [ ] AC-5：daemon/web tests + browser smoke 通过；真实 3103 前端可发消息并停止。

[宪宪/deepseek-flash🐾]
