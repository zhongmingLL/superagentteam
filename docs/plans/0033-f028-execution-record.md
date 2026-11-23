---
title: "F028 execution plan — assistant execution record (history + live)"
doc_kind: plan
status: in-progress
created: 2026-11-23
updated: 2026-11-23
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
related: [features/F028-assistant-execution-record.md, architecture/0007-a2a-runtime-chain.md, architecture/0017-response-draft-store.md, reuse/bubble-pipeline.md]
---

# F028 execution plan

## Goal

让 SuperAgentTeam Hub 的 assistant 消息具备 Clowder 风格的执行记录：
thinking / tool calls 默认折叠、可展开；live 中间结果通过 thread SSE
实时显示；terminal durable message 是最终真相。

## 非目标

见 feature doc；本期不复制 Clowder 的 bubble reducer、rich blocks、nameplate
或 per-cat persona 视觉。

## 切片

### F028.1 契约归一

**改动**

- `packages/superagentteam-shared/src/types/message.ts`：`StoredToolEvent` 改为
  merged record。
- `packages/superagentteam-shared/src/types/invocation.ts`：`DraftRecord.toolEvents`
  使用 `StoredToolEvent[]`。
- `packages/superagentteam-daemon/src/domains/response/sink.ts`：删除重复
  `ToolEventRecord`，复用 shared type；`ResponseSummary.toolEvents` 对齐。
- `packages/superagentteam-daemon/src/domains/response/store.ts` 与
  `settlement.ts`：draft/settlement 类型对齐。
- `packages/superagentteam-web/src/domains/chat/api.ts`：沿用 shared type。
- `docs/architecture/0007-a2a-runtime-chain.md` / `0017-response-draft-store.md`
  / `docs/reuse/bubble-pipeline.md`：记录 merged canonical 与 flat 旧契约的替代。

**验证**

- `f018-r2b-worker-stream` / `f018-r2c-settlement` 保持通过。
- 新增 shared type/API view 测试：真实 merged record 可被 web 消费。

### F028.2 历史态 UI

**改动**

- `packages/superagentteam-web/src/components/chat/MessageExecutionRecord.tsx`：
  thinking panel + tool record panel + tool row detail。
- `MessageList.tsx`：assistant 消息内渲染执行记录；历史 `thinking/toolEvents` 传入。
- `global.css`：F027 token 下的 inset/折叠/工具行样式。
- 单消息 disclosure state；默认 collapsed；错误/空状态。
- `lib/tool-display.ts`：工具名、状态、耗时、args/result 格式化 + 截断 + 脱敏。

**验证**

- component tests：折叠/展开、thinking preview、tool row detail、错误、空状态。
- Playwright 1440/390 + dark 截图。

### F028.3 SSE transport

**改动**

- `ChangeBus`：新增 `StreamEvent` listener/publish（不改变现有 change 语义）。
- `RunAgentTurn`：`onStreamEvent` 包装 `prepared.threadId`。
- `daemon.ts` / `daemon-a2a.ts` / `runtime.ts`：把 stream 发布到 ChangeBus。
- `api/routes/events.ts`：订阅 stream，写 `event: stream` SSE。
- `web/src/domains/events/client.ts`：解析 `stream` 事件。
- `web/src/domains/events/execution-store.ts`：按 turn 合并/去重。

**验证**

- daemon unit/integration：stream 只到对应 thread；ownership 403/404；断连清理。
- web client tests：parse/thread filter/seq dedupe。

### F028.4 Live UI

**改动**

- `useThreadEvents` 增加 `onStream`；ThreadPage 接入 execution store。
- `MessageList`：processing response message / live invocation placeholder
  显示 live text + live execution record；terminal durable 覆盖。
- 自动展开 tool 记录；done 收回；error 状态；scroll 跟随。

**验证**

- web store tests：thinking 追加、tool_call/result 合并、seq 去重、done/error。
- browser E2E：真实或测试 worker 触发一次 live run，确认 terminal 前可见
  thinking/tool，terminal 后折叠且 durable 内容一致。

### F028.5 收口

- 更新 F028 feature progress / BACKLOG / docs README。
- 新增 `docs/reports/2026-11-2x-f028-execution-record.md` 记录验证证据。
- 非作者 review + merge gate。

## 关键依赖与顺序

1. F028.1 必须先做，否则 UI 和 SSE 都会消费错误 shape。
2. F028.2 可在 F028.1 后独立审查/截图。
3. F028.3 与 F028.2 可并行；F028.4 依赖两者。
4. F028 基于 F027 分支堆叠；F027 合入后 rebase 到 `superagentteam-work`。

## 测试矩阵

| 层 | 用例 |
|---|---|
| shared | merged `StoredToolEvent` 类型；Draft/StoredMessage 字段一致 |
| daemon | sink summary、draft 持久化、T2 settlement、stream thread 路由 |
| api | `/api/messages` 返回 merged toolEvents；`/api/events` stream 仅 owner |
| web store | seq 去重、thinking 追加、tool merge、done/error、thread reset |
| web UI | collapsed/expanded、thinking preview、tool detail、错误/空、live 自动展开 |
| browser | 1440/390 light/dark；live run；reload 后 durable 覆盖；无 console error |

## 回滚

- UI/SSE 可独立回滚；契约变更只改类型/读取，不改已有 DB 数据。
- SSE 出问题时可停止发布 stream；Hub 退回 processing placeholder + 终态 durable。
- 不引入迁移，回滚成本 ≤1 commit（除已合入的契约文档）。

## 进展

- 2026-11-23：F028.1–F028.4 完成；F028.5 等非作者 review 和 merge gate。
  证据见 `docs/reports/2026-11-23-f028-live-execution-record.md`。
