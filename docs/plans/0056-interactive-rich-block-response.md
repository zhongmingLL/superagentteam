---
title: "0056: Interactive rich-block response plan"
doc_kind: plan
status: active
created: 2026-11-28
updated: 2026-11-28
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
source_decision: "operator 2026-11-28: rich-block 选择后返回，参考 Clowder，可复用则复用"
---

# 0056: Interactive rich-block response plan

## 目标

把 F031 的只读 `interactive` 富块升级为可选择并返回：一次服务端 action
生成用户消息、投递到 ingress，并持久化 block 的 disabled/selectedIds。

## 现有契约

- `RichBlock` 是开放 shape：`{ id, kind, v: 1, ...kind fields }`；
  `extra.rich = { v: 1, blocks }` 由 F031 T2/T4 写入 response message。
- `MessageStore` 只有 `updateResponseContent` / `updateLifecycle` /
  `appendDispatchRef`，没有通用 extra 写路径。
- `OperatorMessageIngress.submit` 是唯一用户消息入口：message + queue 同事务，
  支持显式 `messageId` 幂等重放，隐式目标链（上一用户消息 targets → 最近
  回复者 → 参与者 → default agent）。
- `ChangeBus` 由 ingress 发布 `messages/queue/thread`；A2ARuntime 未暴露。
- Web：`RichBlocks.tsx` 的 interactive 目前是只读 span；`messageApi.send` /
  `chatStore.send` 已有完整发送路径。

## 工作单元

### W1 — shared + message store

1. `packages/superagentteam-shared/src/types/message.ts`：补
   `InteractiveType` / `InteractiveOption` / `RichInteractiveBlock` 类型视图与
   常量（最多 12 options、label 长度上限）。
2. `MessageStore.updateRichBlockState`：读 message → 找 block → 仅 interactive
   → 合并 patch → 写 `extra_json` / `updated_at`；返回 `{message, block}` 或
   typed null。
3. 单测：保留其他 extra/block、拒绝非 interactive、missing message/block、
   重复写幂等。

### W2 — selection builder + service

1. `domains/rich-blocks/interactive-response.ts`：
   - `parseInteractiveBlock(block)`：校验 interactiveType/options/disabled；
   - `validateInteractiveSelection(block, selectedIds)`：存在性、数量、maxSelect、
     confirm 只能二选一；
   - `buildInteractiveResponseText(block, selectedIds, customInput?)`：与 Clowder
     语义一致（confirm 文案、messageTemplate `{selection}`、labels、title）。
2. 单测覆盖四种 interactiveType、emoji/description、template、customInput、
   超限/非法 id。

### W3 — API route

1. `api/routes/message-actions.ts`：`POST /api/messages/:messageId/rich-blocks/:blockId/respond`。
2. 依赖：runtime（threads/messages/ingress/telemetry）、changeBus、clock。
3. 流程：CSRF → owner → message/block → validate → deterministic messageId
   (`sha256(thread\0rich-block\0message\0block\0ids)`) → ingress.submit →
   updateRichBlockState → changeBus publish（再发一次，确保 block 状态进入刷新）。
4. 错误映射与 F037 风格一致；`ingress_replay_entry_missing` →
   `already_responded` 409。
5. `browser.ts` 接线；`A2ARuntime.changeBus?` 暴露（可选，不破坏测试桩）。
6. telemetry span `superagentteam.rich_block.respond` + `recordMessageAdmitted`?
   （admitted 已由 ingress 自身不记录；只加 span，不重复计数）。

### W4 — Hub

1. `domains/chat/api.ts`：`respondToRichBlock(input)` → POST 上述路径。
2. `domains/chat/store.ts`：`respondToRichBlock(messageId, blockId, selectedIds,
   customInput?)`；成功后 refresh；维护 `respondingBlocks` （可选，本地组件态即可）。
3. `RichBlocks.tsx`：interactive 组件化（select/multi/card-grid/confirm +
   customInput），props：`messageId?`、`onRespond?`；本地 pending/error；
   已 disabled 只读高亮；未提供 onRespond 时保持只读 fallback。
4. `MessageList.tsx` / `ThreadPage.tsx` 透传；CSS 按钮/选中/禁用/错误态；
   390 不溢出。
5. 组件测试：四种 type、customInput、disabled、错误、多选 maxSelect。

### W5 — fullstack + docs + review

1. `f056-interactive-rich-block.test.ts`：mock provider 让 a1 产 interactive
   block → operator respond → a1 第二轮看到选择文本并回复。
2. skill/tool description 更新（interactive 可点击、选择会返回）。
3. F056 feature/report、BACKLOG、`docs/reuse/hub-action-surface.md` +
   `REUSE-MATRIX.md` 更新（interactive response 从 deferred 改为 landed；
   OptionAction 仍 deferred）。
4. 隔离栈 3007/3016 + 1440/390 截图；review packet；CI；merge；runtime 部署。

## 验证命令

- `NODE_ENV=development npx vitest --run test/f056-interactive-rich-block.test.ts test/f031-rich-block-producer.test.ts`
- `NODE_ENV=development npm --prefix packages/superagentteam-daemon test`（full）
- `NODE_ENV=development npm --prefix packages/superagentteam-web test`
- `NODE_ENV=development npm --prefix packages/superagentteam-web run build`

## 风险与回滚

- 回滚：移除 route + web 交互层即回到只读；已写入的 disabled/selectedIds 只是
  extra 字段，渲染器可忽略。
- 不新增 DDL、不新增第二套消息/queue 写路径。

[宪宪/deepseek-flash🐾]
