---
feature_ids: [superagentteam/F028]
related_features: [superagentteam/F018, superagentteam/F020, superagentteam/F027]
title: "F028: Assistant execution record — thinking/tool calls, live and collapsible"
status: in-progress
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: [墨墨 (Qwen 3.8 Flash), 砚砚 (GLM 5.3 Flash)]
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-23
updated: 2026-11-23
source_decision: "operator 2026-11-23: F028 live 中间结果一起做；Clowder 的 thinking/tool 中间结果可显示、可折叠"
---

# F028: Assistant execution record — thinking/tool calls, live and collapsible

## Why

F027 把 Hub 的布局和视觉层次重做了，但 assistant 消息仍只显示最终正文。
Clowder 的聊天框把 thinking 和 tool calls 作为 assistant 气泡内的「执行记录」：
默认折叠，流式时展开，结束后收回；用户仍能点开看中间过程。

SuperAgentTeam 其实已经有这些数据：`StoredMessage.thinking` 和
`StoredMessage.toolEvents` 在 `/api/messages` 返回，daemon 的
`ResponseEventSink` 也在累积 thinking/tool events。缺的是契约一致性和 UI；
live 中间结果还缺一个 SSE 出口。

operator 明确要求：**F028 历史态和 live 中间结果一起做**。

## 用户结果

- assistant 回复先显示正文；正文下方是一条「执行记录」inset，不抢正文层级。
- Thinking：折叠态显示 `› 思考` + 前 60 字预览；展开显示完整 thinking。
- Tool calls：折叠态显示 `执行记录 · N 次工具调用 · 时长`；展开是每个工具一行
  （状态 icon、工具名、耗时）；点单行看 args/result 详情。
- 流式：tool 记录自动展开并显示当前工具；thinking 预览实时更新；结束后
  自动收回默认折叠态（用户手动展开过则不强制收回）。
- 历史消息和 live 消息用同一个组件；light/dark、1440/390 都可读。

## 范围

### Phase A — 历史态

- 统一 tool event 契约（见下）；消除 shared/daemon/web 的类型漂移。
- 新增 `MessageExecutionRecord`：thinking panel + tool record panel。
- 默认折叠；单消息 disclosure 状态；错误/中断/空记录状态。
- 工具 args/result 截断 + 敏感字段脱敏后再展示。

### Phase B — live

- 把 daemon 已有 `AgentStreamEvent` 通过 `/api/events` 的 `stream` SSE 事件
  送给 Hub；thread-scoped、复用现有 session/thread ownership 校验。
- 新增轻量 live execution store：按 `turnExecutionId` 合并 thinking/tool/text
  事件，`seq` 去重；不建第二套 message/bubble 真相源。
- processing response bubble 渲染 live text + live execution record；终态
  durable message 覆盖 live 投影。
- 流式自动展开 tool 记录；`done` 后收回；`error` 显示失败状态。

## 与 Clowder 的差异（有意为之）

| 面 | Clowder | F028 |
|---|---|---|
| tool event 数据 | flat `tool_use` / `tool_result`，UI 按位置配对 | merged `{toolCallId,name,status,at,endedAt,args,result}`，按 toolCallId 合并 |
| live 传输 | 完整 bubble/socket pipeline，draft/callback/multi-slot | `/api/events` 上新增 typed `stream` SSE；单 thread、单 response bubble、无 replay |
| 视觉 | per-cat OKLCH 气泡染色 + 深色 inset | F027 浅蓝 token + 中性 inset；agent 色只做 active tool 强调 |
| 气泡形态 | classic bubble 与 nameplate 两套 | 先做 classic bubble 内嵌执行记录；nameplate 不在本期 |
| 配置 | 全局 bubble defaults + thread override + per-message override | 本期默认 collapsed + per-message override；thread/global 设置后续 |
| 富内容 | rich blocks、replay、recall feed、多 slot | 不做；只消费 thinking/tool/text |
| 真相源 | BubbleReducer / useAgentMessages 收敛 | `messages` + drafts 是真相；live store 只是临时投影，terminal message 覆盖 |

复用卡 `docs/reuse/bubble-pipeline.md` 签于 2026-10-24（thread-first 之前）；
2026-11-23 已按 F018 重基：**R1 约束不变**（不新增第二套 message store、
不让 Hub 成为写真相源、不把 terminal 结果写回 bubble 文本），但旧 `W1/W7`、
`runs`、`dispatch_refs_json`、`rich_blocks_json` 坐标已替换为
`messages`/`drafts`/`turn_executions` + F020/F027/F028 Hub 投影。

## Tool event 契约

以**实际持久化的 merged record** 为 canonical（F018 测试也按此断言）：

```ts
interface StoredToolEvent {
  toolCallId: string;
  name: string;
  status: "running" | "completed";
  at: number;
  endedAt?: number;
  args?: unknown;
  result?: unknown;
}
```

- `DraftRecord.toolEvents`、`ResponseSummary.toolEvents`、`StoredMessage.toolEvents`
  和 web `MessageView.toolEvents` 统一使用该 shape。
- 0007 中 flat `tool_use`/`tool_result` 的声明是旧契约；F028 更新为 merged
  record，并在 reuse 卡记录这一适配差异。
- 不迁移 DB：F018 已经写入 merged record；已有数据可直接消费。
- `contentBlocks` 保持 T2 的最终 text 投影；toolEvents 单独承载执行回放。

## Live SSE 契约

```text
GET /api/events?threadId=<threadId>

event: change
data: { threadId, topics, at }

event: stream
data: { threadId, event: AgentStreamEvent }
```

- `AgentStreamEvent` 沿用 shared 定义：`text | thinking | tool_call |
  tool_result | done | error`，带 `seq` / `agentId` / `turnExecutionId`。
- 服务端在 `RunAgentTurn` 已知 `prepared.threadId` 的地方包一层，再发布到
  `ChangeBus`；订阅端按 thread 过滤。
- 无 replay：重连后 live 记录可能缺一段，processing placeholder 保留；
  terminal durable message 到达后以它为准。客户端按 `(turnExecutionId, seq)`
  去重。
- 事件是 ephemeral presentation，不写 message/DB；`response_drafts` 仍是
  durable streaming 快照。

## 安全与可见性

- SSE 复用 `/api/events` 的 session + thread ownership 校验；不引入新旁路。
- live 事件只发给对应 thread 的订阅者；跨 thread A2A 的 target thread 看
  自己的 stream，source thread 只看 cross-post message。
- thinking/tool args/result 默认折叠；展示前截断大字段，并对
  `token/secret/password/apiKey/authorization/cookie` 等键脱敏。
- 不在日志或 URL 中回显敏感参数。

## 验收标准

- [x] shared/daemon/web 的 `toolEvents` 类型与真实 `/api/messages` 数据一致。
- [x] 历史 message：thinking 可折叠/展开；tool record 可折叠/展开；单工具详情可展开；错误状态可见。
- [x] live：processing response bubble 在 terminal 前显示 thinking/tool 中间结果；tool 记录自动展开，done 后收回。
- [x] `seq` 去重；重复/乱序事件不重复渲染；重连后 terminal message 覆盖 live 记录。
- [x] SSE 只对 thread owner 可见；跨 thread 不泄漏；无 session 时 401。
- [x] light/dark、1440/390 截图；无横向溢出、无 console error。
- [x] web typecheck/tests/build、daemon 相关 tests、doc-index 全绿。
- [x] 现有 F027/A2A 行为不回退：未读、rename、retry、live/queue、cross-thread、multi-mention、草稿。
- [ ] 非作者 review（视觉 + 代码/安全面）通过。

## 非目标

- Clowder 的 per-cat OKLCH 气泡、rich block/replay/recall/multi-slot。
- nameplate 显示模式和 thread/global bubble defaults UI。
- 消息编辑、附件、Markdown 全量渲染升级。
- 第二套 message store、前端写消息、BubbleReducer 复制。

## 风险与回滚

- **契约变更**：shared/daemon/web 三处同时改；现有 DB 数据已是 merged
  shape，无需迁移。回滚只影响 UI 读取，不改数据。
- **SSE 负载**：thinking/text delta 可能高频；服务端沿用现有 ChangeBus
  同步发布，后续如压力大可加 per-thread 缓冲/节流。
- **敏感信息**：thinking/tool args 可能含 secret；默认折叠 + 脱敏 + 截断。
- **F027 堆叠**：F028 基于 F027 分支堆叠；F027 合入后 rebase 到
  `superagentteam-work`。

## 进展

- 2026-11-23：operator 拍板 F028 历史态 + live 一起做；调查确认 Clowder
  的折叠信息架构、SuperAgentTeam 已有 thinking/toolEvents 数据、以及
  tool event 契约漂移。实现开始。
- 2026-11-23：实现完成并通过验证：
  - shared/daemon/web tool event 契约统一为 merged record；
  - `MessageExecutionRecord` + history 折叠/展开；
  - `ChangeBus` stream + `/api/events` `stream` SSE + web execution store；
  - 真实 Kimi agent 回合在 terminal 前显示「正在调用」tool 记录；
  - daemon 132 files / 887 tests、web 24 files / 95 tests、build 全绿；
  - 证据报告：`docs/reports/2026-11-23-f028-live-execution-record.md`。
