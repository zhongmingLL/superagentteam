---
cell: bubble-pipeline
title: "P0 复用卡：Bubble Pipeline"
doc_kind: reuse-card
status: approved
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: [烁烁 (Kimi K3), 砚砚 (GLM 5.3 Flash), 墨墨 (Qwen 3.8 Flash)]
operator_signoff: "approved 2026-10-24"
created: 2026-10-24
updated: 2026-11-23
thread_first_revalidated: 2026-11-23
---

# P0 复用卡：Bubble Pipeline

## 结论

| 项 | 值 |
|---|---|
| decision | **R1 适配复用** |
| priority | **P0** |
| codeteam W | W1 / W7 |
| 一句话 | 一条 provider 事件只投影成一个可见 bubble；codeteam 复用消息身份与 dispatchRefs，不另造聊天层。 |
| operator 签字 | [x] 已签（2026-10-24） |

## 覆盖

- canonical: F177 / F183 / F254 / F264 / F322
- explicit: F117 / F177 / F201 / F220 / F224 / F229 / F247 / F254 / F294 / F299 / F306 / F325
- Batch 0 legacy 归属：bubble continuity、message identity、CLI output、callback message 等（见 inventory 中 `architecture_cell=bubble-pipeline`）。

## Current truth

- **单一投影边界**：provider-normalized semantic event → 用户可见 bubble；服务器 message identity、named-message writer、live/hydration convergence 与 terminal projection 都在这一层收口。
- **实际投递与消息正文分家**：`dispatchRefs[]` 记录 source×target 的真实投递与 response identity；bubble 只消费这些事实，不从 Queue 字段猜终态。
- **代码面**：`bubble-event-adapter.ts`、`BubbleReducer.ts`、`useAgentMessages.ts`、`useChatHistory.ts`、`useSocket.ts`、`MessageDispatchAvatars.tsx`。
- **不采用**：前端直接写消息、双 write-path、用 provider 成功或日志文本推断 delivered/handled。

## 2026-11-23 thread-first revalidation

本卡签于 **2026-10-24**；F017 Phase A 于 **2026-11-04** 归档，F018 thread-first
runtime 同日立项（`0005-thread-first-runtime.md` / `0007-a2a-runtime-chain.md`）。
因此卡里的 `W1/W7`、`runs`、`dispatch_refs_json`、`rich_blocks_json` 是
**task-first 时代坐标**，不能原样当作 current truth。

R1 决策仍然成立，但它依赖的是三条 runtime-agnostic 不变量，而不是旧表名：

1. **单一投影**：execution/provider event 只投影成一条可见 response bubble；
2. **真相分离**：message identity / terminal / dispatch 事实由服务端持有，Hub 只读；
3. **不新增**第二套 message store、第二套 bubble reducer、前端直接写消息。

## thread-first mapping

- **F018 durable truth**：`messages` 是聊天真相（`body_md` / `content_json` /
  `tool_events_json` / `thinking` / `lifecycle_json` / `extra_json`）；
  `response_drafts` 是 in-flight snapshot；`turn_executions` / `InvocationRecord`
  持 execution terminal；input delivery refs 在
  `message.lifecycle.input.dispatchRefs`；富块在 `message.extra.rich`。
- **F020/F027/F028 Hub**：只读投影；一条 response message 对应一条 bubble；
  terminal message 覆盖 live 投影；F028 的 thinking/tool record 读
  `messages.thinking` / `messages.toolEvents`，live 中间结果只走 ephemeral
  `AgentStreamEvent`，不写第二套消息。
- **P0 锁定范围**：F018 的 message identity + lifecycle/terminal 契约 +
  `lifecycle.input.dispatchRefs`，不是旧 `dispatch_refs_json` / `rich_blocks_json`。
- **旧列**：`runs`、`dispatch_refs_json`、`rich_blocks_json` 只作为
  task-first legacy 只读历史（`0005` / `0006`），新代码不得再建写路径。
- 证据不全时仍显示 `unknown`，不显示 `running`（fail-closed 语义保留）。
- F028 适配差异：`toolEvents` 用 merged
  `{toolCallId,name,status,at,endedAt,args,result}` 作为 canonical（按
  toolCallId 合并），不复刻 Clowder 的 flat `tool_use`/`tool_result` 位置配对；
  live 中间结果走 `/api/events` 的 typed `stream` SSE，仍遵守单投影边界。

## 风险与回滚

- **风险 P1**：Hub 自建 socket/history/send 路径，导致 live 与 hydration 分叉、ghost bubble。
- **风险 P2**：把 terminal 结果写回 bubble 文本，导致无法从证据账本恢复。
- **回滚**：bubble/pipeline 是投影层；回滚只影响 Hub 展示，不影响 `messages` /
  `turn_executions` 真相。

## Review

| 角色 | 关注面 | 结论 |
|---|---|---|
| 烁烁 | message identity、reconcile、W1/W5 交叉 | accept（本轮已处置） |
| 砚砚 | 跨 thread 可见性、消息伪造边界 | accept（本轮已处置） |
| 墨墨 | W7 聊天/气泡体验、one terminal | accept（本轮已处置） |
| operator | cell 级决策 | [x] 已签（2026-10-24） |

**2026-11-23 revalidation**：宪宪按 F018 thread-first 重基 mapping；R1 决策不变，
仅把 task-first 坐标替换为 thread-first 坐标。operator 问题的触发记录见 F028。

[宪宪/deepseek-flash🐾]
