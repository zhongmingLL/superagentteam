---
title: "0055: Thread-first runtime observability plan"
doc_kind: plan
status: active
created: 2026-11-28
updated: 2026-11-28
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
source_decision: "operator 2026-11-28: 运行时可观测基础设施，重新调研 Clowder，可复用或重新设计，实现"
---

# 0055: Thread-first runtime observability plan

## 目标

复用 F013 的 local-first observability runtime，把 trace/metrics/logs 契约重基到
thread-first 运行时，并在 A2A 主链埋点，补只读 API 与 Hub Observability 面板。

## 现有契约

- `ObservabilityRuntime`：`LocalTraceStore`（10k/24h ring）、`MetricsRegistry`
  （Prometheus snapshot）、`JsonlLogStore`、redaction/salt、OTLP 可选。
- daemon `/health`、`/ready`、`/metrics`；`A2ALog` 已写 JSONL。
- `A2ARuntime`: ingress/queue/route/turn/tool/steer/session-seal 组件。
- `TraceQuery` 目前是 invocation/profile/name/time；attribute allowlist 还是
  task-first key。

## 工作单元

### W1 — contract 重基

1. `contracts.ts`：`TraceQuery` 增加 threadId/agentId/turnExecutionId/queueEntryId/
   sessionId；保留 profileId legacy。
2. `redaction.ts`：trace allowlist / Class C / strict log allowlist / metric label
   allowlist 补 thread-first key。
3. `trace-store.ts`：query filters HMAC + match new attributes。
4. `metrics.ts`：`snapshot()` JSON projection。
5. 单测：filters、HMAC、allowlist、snapshot。

### W2 — RuntimeTelemetry facade

1. `observability/runtime-telemetry.ts`：包装 tracer/metrics/logs/readiness；
   `startSpan`、`registerTurn`、`startToolSpanFromTurn`、record* helpers；
   `enabled`/disabled no-op。
2. `A2ARuntimeDeps.telemetry`；`A2ARuntime.telemetry`；`daemon.ts` 构造并注入。
3. `PreparedDispatch.trace?: SpanContext`；QueueProcessor/Route/RunAgentTurn 传递。

### W3 — 主链埋点

1. Ingress submit：`superagentteam.ingress` + admission counter。
2. QueueProcessor.processEntry：`superagentteam.queue.process` + queue depth/processed。
3. AgentRouter.routeAgents：`superagentteam.route`（parallel/serial）。
4. RunAgentTurn.run：`superagentteam.turn` + worker/prompt/T1 events；
   turn started/completed/duration/active counters。
5. A2AControlServer.handleA2ACall / handleRichBlockCreate：`superagentteam.tool`；
   parent = turn span via registry；tool_calls_total。
6. SteerService / SessionSealService：`superagentteam.steer` / `.session.seal`。
7. 失败路径：span status error + error.kind；不抛入主链。

### W4 — 读 API

1. `api/routes/telemetry.ts`：
   - traces / traces/stats / metrics / metrics/prometheus / logs / health；
   - session auth；thread owner filter（traces threadId 时校验）。
2. `browser.ts` 注册；`daemon.ts` 注入 RuntimeTelemetry。
3. API tests：401/200、filters、stats、logs、health。

### W5 — Hub

1. `domains/telemetry/api.ts` + `ObservabilityDialog` + topbar button。
2. 健康卡片、metrics 摘要、trace 列表/详情、logs tail。
3. Web tests；1440/390 实机截图。

### W6 — 验证 / 收口

1. fullstack E2E：真实 pi worker + mock provider，post message → turn span/metrics。
2. daemon full、web tests/typecheck/build、doc-index、biome。
3. 非作者 review、CI、合入、runtime 部署、Hub 实机。

## 验证顺序

1. `npx vitest --run test/f055-* test/observability-*`
2. daemon full
3. web test + `check:web`
4. 隔离 3007/3016 实机
5. doc-index

## 回滚

纯增量 facade/route/UI + 可选埋点；回滚 code commit 即可。无 DDL 变更。
telemetry disabled 时所有埋点 no-op，运行时行为不变。

[宪宪/deepseek-flash🐾]
