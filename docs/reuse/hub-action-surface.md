---
cell: hub-action-surface
title: "P1 复用卡：Hub Action Surface — rich blocks 子面"
doc_kind: reuse-card
status: draft
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: []
created: 2026-11-24
updated: 2026-11-24
---

# P1 复用卡：Hub Action Surface — rich blocks 子面

## 结论

| 项 | 值 |
|---|---|
| decision | **R1 适配复用** |
| priority | **P1-active** |
| codeteam W | W7 |
| 一句话 | 复用 Clowder 的 rich block 形状与展示语义；先做只读展示层，生产端与 action runtime 后续接入。 |

## Current truth

- SuperAgentTeam 已有富块**契约与持久化**：
  `RichBlockKind` / `RichMessageExtra` 在 shared types；`StoredMessage.extra.rich`；
  `/api/messages` 校验 `extra.rich = {v:1, blocks:[...]}`；A2A router 接受
  `extra.rich` 并写入 `messages.extra_json`。
- 缺的是 **Hub 展示层**：web 只 import 类型，没有 renderer；也缺 agent 侧
  生产工具（本 phase 不做）。
- 富块与 `contentBlocks`（LLM 原始 text/tool_call/tool_result）语义不同：
  `extra.rich` 是派生展示，不替代正文。

## 代码面

参考实现（只读）：

- `packages/shared/src/types/rich.ts`：8 种 block 的 shape。
- `packages/web/src/components/rich/RichBlocks.tsx`：kind 分派与 fallback。
- `packages/web/src/components/rich/CardBlock.tsx` / `DiffBlock.tsx` /
  `ChecklistBlock.tsx` / `MediaGalleryBlock.tsx` / `FileBlock.tsx` /
  `AudioBlock.tsx` / `HtmlWidgetBlock.tsx` / `InteractiveBlock.tsx`。

SuperAgentTeam 落点：

- `packages/superagentteam-shared/src/types/message.ts`：现有契约。
- `packages/superagentteam-web/src/components/chat/MessageList.tsx`：消息渲染入口。
- `packages/superagentteam-web/src/components/chat/RichBlocks.tsx`：新增展示层。

## codeteam mapping

- 保留 block shape 与 `v:1`；样式接 F027 的浅蓝 token，不复刻 Clowder 的
  per-cat OKLCH / breed font。
- `card` 的 body 复用 Hub 的 markdown 渲染；`html_widget` 用 sandbox iframe；
  `media_gallery` / `file` / `audio` 只读 URL；`interactive` 先只读展示。
- 不引入 Clowder 的上传、TTS、RichBlock action runtime、转发与 recall 管线；
  这些是 Phase 2 的独立决策。
- 未知 kind 必须显示 fallback，不静默丢弃；块数/媒体数/高度有边界。

## 风险与回滚

- **P1**：把富块当正文真相，覆盖 `content`。不采用；`extra.rich` 只做展示。
- **P2**：html_widget 逃逸或执行越权脚本。sandbox + 无 same-origin。
- **回滚**：纯展示层，≤1 commit；不影响已持久化的 `extra.rich`。
