---
feature_ids: [superagentteam/F055]
related_features: [superagentteam/F018, superagentteam/F053, superagentteam/F054]
title: "F055: Thread-first runtime observability — traces、metrics、logs + Hub panel"
status: implemented
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: []
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-28
updated: 2026-11-28
source_decision: "operator 2026-11-28: 运行时可观测基础设施，重新调研 Clowder，可复用或重新设计，实现"
---

# F055: Thread-first runtime observability

## Why

SAT 已有 F013 的 local-first telemetry runtime（redaction、trace ring、Prometheus
metrics、JSONL logs、`/ready`、`/metrics`），但它是 task-first 时代接的：

- trace attribute/query 仍以 `runId` / `profileId` / `task.id` 为主；
- A2A 主链（ingress → queue → route → Phase B → turn → T1/T2）没有 span/metrics；
- 没有 operator 可用的 telemetry 读 API 或 Hub 面；
- queue depth、turn latency、tool calls、steer、session seal 都不可见。

Clowder F153 的结论是 **descriptive observability plane**：raw telemetry /
redaction / health 归一个 owner；trace/metrics/logs 只回答“发生了什么”，不做
质量判断。SAT 复用这个边界，不引入第二套 truth store。

## 用户结果

- operator 在 Hub 顶栏打开 Observability，能看到：健康/readiness、队列深度、
  active/completed turns、失败数、最近 trace 列表与 span 属性/事件、日志尾部。
- 每次 operator message / A2A turn / A2A tool / steer / session seal 都有
  thread-first 的 trace 坐标（thread/agent/invocation/turn/attempt/queue/session）。
- 原始 prompt/正文/凭证/文件内容不进 trace/log；ID 按 HMAC 脱敏；metric labels
  保持 bounded。
- telemetry 初始化失败只降级，不阻塞 control plane；`/ready` 如实报告组件状态。

## 范围

### 契约重基

- `TraceQuery` / `TraceSpanDTO` 增加 thread-first filters：
  `threadId`、`agentId`、`invocationId`、`turnExecutionId`、`queueEntryId`、
  `sessionId`；保留 `profileId` 作为 legacy alias。
- `TRACE_ATTRIBUTE_ALLOWLIST` 增加 `agent.id`、`turn.execution.id`、`attempt.id`、
  `worker.id`、`queue.entry.id`、`session.id`、`parent.invocation.id`、
  `queue.kind/priority`、`a2a.depth`、`turn.status`、`phase`、`steer.mode`、
  `seal.reason` 等；ID 继续 HMAC，未知 key 继续 drop。
- metric label allowlist 增加 bounded `phase`、`queue.kind`、`steer.mode`、
  `seal.reason`、`turn.status`；不把 thread/agent/invocation 作为 label。
- strict log allowlist 补 thread-first ID/phase/steer/seal 字段。

### 埋点

- `superagentteam.ingress`：operator message admission。
- `superagentteam.queue.process`：queue entry claim/dispatch。
- `superagentteam.route`：AgentRouter parallel/serial。
- `superagentteam.turn`：Phase B → worker → prompt → T1；child events
  `phase_b` / `worker_bound` / `prompt_accepted` / `turn_terminal`。
- `superagentteam.tool`：A2A control socket 的 post_message / cross_post_message /
  multi_mention / thread_context / create_rich_block。
- `superagentteam.steer`（F053）、`superagentteam.session.seal`（F054）。
- Metrics：`queue_depth`、`messages_admitted_total`、`turns_started/completed_total`、
  `turn_duration_ms` histogram、`tool_calls_total`、`steer_total`、`session_seals_total`、
  `errors_total`。

### 读 API

- `GET /api/telemetry/traces`（thread/agent/invocation/turn/queue/session/name filters；
  始终按 session user 的 HMAC `user.id` 收窄）。
- `GET /api/telemetry/traces/stats`。
- `GET /api/telemetry/metrics`（JSON snapshot）与 `GET /api/telemetry/metrics/prometheus`。
- `GET /api/telemetry/logs`（tail）。
- `GET /api/telemetry/health`（daemon health + telemetry readiness）。
- 全部走 browser session/cookie 鉴权；不使用公开 `/ready` 模式。

### Hub

- topbar `Observability` → dialog：健康卡片、metrics 摘要、recent traces + span
  详情、logs tail；1440/390 光暗无横向滚动。

## 非目标

- 不引入 OTel SDK / Redis / 外部 telemetry backend；OTLP 保持现有可选 exporter。
- 不做 metrics history snapshot store、burn-rate 告警、trace 持久化/hydration。
- 不做 Prompt X-Ray、跨进程 trace propagation、eval verdict。
- 不复制 Clowder 的 `run_events`/`tool_usage_counters`；thread-first 只读 canonical
  runtime 对象。
- 不改 A2A 行为契约；埋点失败不得阻塞执行（telemetry best-effort）。

## 验收标准

- [x] AC-1：trace 查询支持 thread/agent/invocation/turn/queue/session filters；
      raw ID → HMAC 匹配；未知 attribute 继续 drop。
- [x] AC-2：ingress/queue/route/turn/tool/steer/seal 产生 span；turn span 带
      provider/model/attempt/turn status；tool span 挂在对应 turn 下（能挂则挂）。
- [x] AC-3：metrics 暴露 queue depth、admissions、turn started/completed/duration、
      tool/steer/seal/errors counters；label 仅 bounded enum。
- [x] AC-4：`/api/telemetry/*` 鉴权、filters、stats、logs、health 契约可用；
      不泄漏 raw prompt/content/credential。
- [x] AC-5：Hub Observability 面板列出健康/metrics/traces/logs；1440/390 无横向
      滚动；空/降级状态如实显示。
- [x] AC-6：fullstack（真实 pi worker + mock provider）验证一次 turn 产生完整
      span 链和 metrics；daemon full + web tests/typecheck/build + doc-index 绿。

## 实现

- `RuntimeTelemetry` facade（`observability/runtime-telemetry.ts`）包 tracer/
  metrics/logs/readiness；disabled 时 no-op。
- trace allowlist / Class C / strict log / metric label allowlist 增加 thread-first
  ID/phase/steer/seal 字段；`TraceQuery` 增加 thread/agent/invocation/turn/queue/
  session filters；`LocalTraceStore` HMAC 匹配。
- `MetricsRegistry.snapshot()` JSON projection。
- 埋点：message route ingress、QueueProcessor queue process + queue depth、
  AgentRouter route、RunAgentTurn turn/worker/prompt/T1、A2AControlServer tool、
  SteerService steer、SessionSealService session seal。
- `api/routes/telemetry.ts`：traces/stats/metrics/metrics-prometheus/logs/health；
  browser session 鉴权 + thread/session owner check。
- Hub：topbar Observability → health/traces/metrics/logs dialog。

## 证据

- 报告：[`2026-11-28-f055-runtime-observability.md`](../reports/2026-11-28-f055-runtime-observability.md)
- 截图：`docs/design/F055/f055-observability-traces-1440.png`、
  `f055-observability-metrics-1440.png`、`f055-observability-logs-1440.png`、
  `f055-observability-390.png`。
- daemon 580 passed / 5 skipped；web 28 files / 136 tests + tsc/vite build。
- 隔离 3007/3016：queue/route/turn/ingress 4 spans、7 metric series、log tail；
  390 `scrollWidth=390`。

## 分阶段

| Phase | 内容 | 出口 |
|---|---|---|
| P1 | contract 重基 + RuntimeTelemetry facade | 契约/单测绿 |
| P2 | ingress/queue/route/turn/tool/steer/seal 埋点 | fullstack span/metrics 绿 |
| P3 | telemetry read APIs | API 契约测试绿 |
| P4 | Hub Observability dialog | 1440/390 实机 |
| P5 | 非作者 review + 部署 | CI + runtime 验证 |

## 风险

- **高基数**：metric labels 只用 bounded enum；ID 只进 span/log（HMAC）。
- **埋点阻塞**：telemetry 调用全部 try/catch 或 no-op；disabled runtime 返回 null。
- **trace 被当账本**：ring 是 cache；canonical truth 仍是 runtime 表；缺 trace 显式
  `trace_unavailable`。
- **内容泄漏**：沿用 A-D redaction + allowlist；新增字段必须先入 allowlist 才可见。

## 证据

- 计划：`docs/plans/0055-runtime-observability.md`
- 报告：`docs/reports/2026-11-28-f055-runtime-observability.md`（执行时创建）
- 参考：Clowder F153、`docs/reuse/observability.md`、SAT F013
- 合入与部署：PR #280 merged `ec986b786`；砚砚 approve @ `262ae3950`，
  CI 5/5；runtime 3005/3014 已重启到 `ec986b786`。部署核验：runtime data dir
  的 `telemetry-salt` 存在；一条真实 ingress 触发 `ingress → queue.process →
  route → turn` 4 spans（全 ok，HMAC ID）；`/api/telemetry/metrics` 7 series、
  `/api/telemetry/logs` 可读、`/api/telemetry/health` trace/metrics/logs ready。

[宪宪/deepseek-flash🐾]
