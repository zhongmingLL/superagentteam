---
title: "F055 Thread-first runtime observability — implementation report"
doc_kind: report
status: active
created: 2026-11-28
updated: 2026-11-28
source_decision: "operator 2026-11-28: 运行时可观测基础设施，重新调研 Clowder，可复用或重新设计，实现"
---

# F055 Thread-first runtime observability — implementation report

## 背景

SAT 已有 F013 local-first telemetry runtime（trace ring、Prometheus metrics、
JSONL logs、redaction、`/ready`、`/metrics`），但契约是 task-first 的
`runId/profileId`，A2A 主链没有 span/metrics，也没有 operator 读面。F055 复用
现有 runtime，把坐标重基到 thread-first，并补主链埋点、read API 和 Hub 面板。

## Clowder 参考

- F153：descriptive observability plane；raw telemetry / redaction / health 单一
  owner；trace/metrics/logs 不做质量判断。
- Phase E 的安全边界：Redacting processor 之后才进 local store；raw ID HMAC 后
  查询；`/api/telemetry/*` 走 session auth；ring 双阈值；metrics 直读进程内
  registry。
- SAT 不引入 OTel SDK/Redis/外部 backend；保留 F013 的 local-first + 可选 OTLP。

## 实现

- **契约**：`TraceQuery` 增加 threadId/agentId/turnExecutionId/queueEntryId/
  sessionId（`profileId` 保留 legacy）；trace allowlist/Class C/strict log/metric
  label allowlist 增加 `agent.id`、`turn.execution.id`、`attempt.id`、
  `worker.id`、`queue.entry.id`、`session.id`、`queue.kind/priority`、
  `a2a.depth`、`turn.status`、`phase`、`steer.mode`、`seal.reason`、
  `error.kind` 等；ID 仍 HMAC。
- **RuntimeTelemetry**：`startSpan`、`registerTurn`、`startToolSpan`、record*
  helpers；disabled 时 span=null、metrics no-op；所有埋点 best-effort。
- **埋点**：
  - message route `superagentteam.ingress` + admitted counter；
  - QueueProcessor `superagentteam.queue.process` + queue depth/processed；
  - AgentRouter `superagentteam.route`；
  - RunAgentTurn `superagentteam.turn`（phase_b/worker_bound/prompt_accepted/
    turn_terminal events；provider/model/attempt/turn attrs；duration/started/
    completed metrics）；
  - A2AControlServer `superagentteam.tool`（post/cross/multi_mention/
    thread_context/create_rich_block；turn span parent + tool.call.id）；
  - SteerService `superagentteam.steer`；SessionSealService
    `superagentteam.session.seal`。
- **API**：`GET /api/telemetry/traces`、`/traces/stats`、`/metrics`、
  `/metrics/prometheus`、`/logs`、`/health`；session auth；thread/session owner
  check；所有 trace 查询额外按 session user 的 HMAC `user.id` 收窄；logs raw
  fields 仍 strict allowlist。
- **Hub**：topbar Observability → 健康卡、Traces（filter + span detail）、
  Metrics 表、Logs tail；390 窄屏按钮收成图标。

## 验证

- `observability-trace.test.ts` + `observability-metrics.test.ts` +
  `observability-runtime-telemetry.test.ts`：15/15（新 filters、HMAC、snapshot、
  span parent/metrics/logs/disabled no-op）。
- `f055-telemetry-api.test.ts`：1/1（auth、traces filters、stats、metrics、
  prometheus、logs、health、404）。
- `f037-fullstack-e2e.test.ts`：3/3，新增真实 worker 的 telemetry 断言
  （ingress/queue/route/turn spans、tool span、turn metrics）。
- daemon full：**580 passed / 5 skipped**；web **28 files / 136 tests** + tsc/vite build。
- 隔离 3007/3016 + mock provider：Observability 面板实测 4 spans（queue.process/
  route/turn/ingress）、7 metric series、log tail；390 `scrollWidth=390`，
  dialog 宽 358。
- 截图：`docs/design/F055/f055-observability-traces-1440.png`、
  `f055-observability-metrics-1440.png`、`f055-observability-logs-1440.png`、
  `f055-observability-390.png`。

## 已知限制

- trace ring 仍是 10k/24h 内存 cache，重启丢失；无 persisted/hydrated trace。
- 无 metrics history snapshot store / burn-rate / 告警；只有当前 Prometheus
  快照和 JSON projection。
- 无 Prompt X-Ray、跨进程 trace propagation、采样配置；OTLP 保持 F013 的可选
  exporter。
- tool span 只覆盖 daemon 侧 A2A control socket；worker 内部 provider/tool
  执行由 pi 自己的事件表达，未合并进本 trace。
- `agent.id`/`thread.id` 等 trace attrs 是 HMAC，Hub 无法从 HMAC 反查 display
  name；这是有意的脱敏边界。
- queue depth 是进程级 gauge；多 daemon 实例不聚合。

## 合入与部署

- PR #280 merged `ec986b7862f0b8a47b78ddc3de597004ee8d6366`（base `superagentteam-work`）。
- 非作者 review：砚砚 approve @ `262ae3950`（覆盖 `d0067c515` user-scoping 与
  `262ae3950` seal metric label 收敛两笔 delta），无 P1/P2。
- CI：run `46129042482` 最终 5/5（build-check-test 2m56s，headSha = `262ae3950`）。
  首跑在既有 F044 `multi_mention` 用例的 callback 终态断言上 flake
  （`expected 'running' to be 'completed'`）——该 wait 条件只等消息可见、不等
  callback 落终态；重跑 5/5、本地 f044 套件与 daemon full 复跑仍绿，判定为测试
  等待条件不敏感，非 F055 引入（F056 PR 已把 wait 扩到 callback=completed，
  并连续复跑验证）。
- 部署：`/home/ming/agent/superagentteam-runtime` checkout 并重启到 `ec986b786`；
  `/health.runningRevision` 逐字一致（bootSequence 77）。
- 部署核验（真实 runtime 3005/3014）：
  - runtime data dir 的 `telemetry-salt` 存在 → HMAC 脱敏接线成立。
  - 一条真实 ingress（测试 thread `queue-测试`）触发完整链：
    `superagentteam.ingress` → `queue.process` → `route` → `turn`，4 spans 全部
    status ok；turn provider/model = `deepseek/deepseek-flash`；span 内
    thread/user/agent/message ID 均为 HMAC（32 hex），非裸 ID。
  - `/api/telemetry/metrics`：7 series（messages admitted、queue depth/processed、
    telemetry_up、turns started/completed、turn duration histogram count=1 sum≈29s）。
  - `/api/telemetry/logs`：structured events 可读（turn_terminal/route_context/
    phase_b_appended），无 raw prompt/content。
  - `/api/telemetry/health`：trace ready（4 spans / 10k / 24h）、metrics ready
    （7 series）、logs ready、otlp disabled；traces 查询返回
    `availability=available`。

## 状态

- 实现、单测、review、CI、合入与 runtime 部署完成；等待 operator 实机确认后标
  `done`。

[宪宪/deepseek-flash🐾]
