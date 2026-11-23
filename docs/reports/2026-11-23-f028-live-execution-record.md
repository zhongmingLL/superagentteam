---
title: "F028 live execution record — implementation evidence"
doc_kind: report
status: draft
created: 2026-11-23
updated: 2026-11-23
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
related: [features/F028-assistant-execution-record.md, plans/0033-f028-execution-record.md]
---

# F028 live execution record — implementation evidence

## Delivered

- **Contract**：`StoredToolEvent` 统一为 merged record
  `{toolCallId,name,status,at,endedAt,args,result}`；shared / daemon sink /
  response draft / message store / `/api/messages` / web `MessageView` 对齐。
- **History UI**：assistant 消息内新增 `MessageExecutionRecord`：Thinking
  折叠/展开 + tool 执行记录折叠/展开 + 单工具 args/result 详情；默认折叠，
  大字段截断，敏感键脱敏；执行记录位于最终正文上方（operator 2026-11-23 要求）。
- **Live transport**：`AgentStreamEvent` 经 `ChangeBus.publishStream` 发到
  `/api/events` 的 `stream` SSE 事件；thread-scoped，复用现有 session/thread
  ownership 校验。
- **Live UI**：`execution-store` 按 `turnExecutionId` 合并 thinking/tool/text，
  按 seq 去重；processing bubble 显示 live text + 自动展开的 tool 记录；
  `done` 后收回；durable terminal message 覆盖 live 投影。
- **Scroll**：执行记录展开时发 `superagentteam:chat-layout-changed`；消息列表
  在 pinned 状态下跟随到底部。

## Evidence

### Automated

- `npm test --prefix packages/superagentteam-daemon`：132 files / 887 tests
  pass，3 skipped。
- `npm test -w @superagentteam/web`：24 files / 95 tests pass。
- `npm run build -w @superagentteam/web`：production build pass。
- `npm run build -w @superagentteam/shared`、daemon build pass。
- `check:doc-index`、`check:ts-imports`、`check:entry-graphs` pass。

### Real live run

Isolated stack：daemon `3013` + Vite `3002` + Windows bridge `3102`，
data copy `/tmp/f028-live/data`（未触碰 3101 dev stack）。

Agent A 的 real provider 回合（`superagentteam_thread_context`）：

- `/api/events` SSE 收到 45 个 `thinking`、3 个 `tool_call`、3 个
  `tool_result`、643 个 `text`、3 个 `done`。
- UI 在 terminal 前出现 `执行记录 · 正在调用 superagentteam_thread_context`、
  运行中 spinner 和 topbar live pill。
- terminal 后 durable assistant message 显示答案、Thinking 折叠态和
  `执行记录 · 1 次工具调用`；执行记录在正文上方，展开后能看到 tool 行与
  args/result。

### Screenshots

- [history-1440.png](../design/F028/history-1440.png)
- [history-top-1440.png](../design/F028/history-top-1440.png)
- [history-execution-expanded-1440.png](../design/F028/history-execution-expanded-1440.png)
- [history-tool-detail-1440.png](../design/F028/history-tool-detail-1440.png)
- [history-390.png](../design/F028/history-390.png)
- [history-390-dark.png](../design/F028/history-390-dark.png)
- [live-running-390.png](../design/F028/live-running-390.png)

## Known follow-ups

- thread/global bubble defaults UI 未做；本期只做默认 collapsed + per-message。
- live thinking 的可视内容取决于 provider 是否发 thinking delta；本期已接，
  但 Kimi 回合的 thinking 是否出现由模型决定。
- SSE 无 replay：重连后 live 可能缺段，terminal durable message 是最终真相。
- F028 基于 F027 分支堆叠；F027 合入后 rebase 到 `superagentteam-work`。
