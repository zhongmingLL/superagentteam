---
feature_ids: [superagentteam/F049]
related_features: [superagentteam/F029, superagentteam/F043, superagentteam/F045, superagentteam/F046, superagentteam/F050]
title: "F049: A2A message surface parity"
status: planned
owner: "墨墨 (Qwen 3.8 Flash)"
reviewers: []
vision_guard: "operator"
created: 2026-11-27
updated: 2026-11-27
source_decision: "operator 2026-11-27: 全量纠正 0007 偏移；消息表面作为独立 feature，F043 A+C 仅作视觉输入"
---

# F049: A2A message surface parity

> **先读（强制）**：
> - [`0007-a2a-runtime-chain.md`](../architecture/0007-a2a-runtime-chain.md)：target contract。
> - [`0019-a2a-runtime-chain-as-built.md`](../architecture/0019-a2a-runtime-chain-as-built.md)：当前 as-built，原 0008 as-built。
> - [`2026-11-27-0007-as-built-audit.md`](../reports/2026-11-27-0007-as-built-audit.md)：A–F 偏移证据。
> - [`0050-a2a-runtime-alignment.md`](../plans/0050-a2a-runtime-alignment.md)：本计划。
>
> 本 feature 只实现消息表面；不得改 A2A 调度/投递语义。

## 覆盖的 audit 偏移

**F043 AC-4 / 0007 §3.8 aggregate + message lifecycle**：A2A 私有消息与
multi-mention burst 的展示语义。

## Why

F043 AC-4 还没完成：A2A 私有消息可能和公开回复长得一样，multi-mention burst 可能
散落成多个气泡。operator 2026-11-27 的方向是把表面放回整体 A2A 设计，而不是在 F043
上继续补。F043 已选设计 A（无头像私有气泡）+ C（multi-mention 汇总卡）保留为视觉输入。

## 用户结果

- A2A 私有消息默认收成“投递回执行”或无头像私有气泡，需要时可展开正文。
- multi-mention 一轮多 target 回答归入一个汇总卡，不散落成多个公开回复气泡。
- 桌面/移动、浅色/深色一致；不与普通 operator/agent 对话混淆。

## 范围

- 前端消费 F045/F046 的 lifecycle/`extra.multiMention` 元数据，渲染私有气泡/汇总卡。
- 沿用 `docs/design/F043/` 的 A+C 视觉方向；必要时补 Pencil 稿。
- 1440/390、浅色/深色截图；AC-4 验收。

## 非目标

- 不改后端 route/context/multi_mention 语义。
- 不改普通消息气泡、rich block、取消/重试交互。
- 不新增 i18n。

## 验收

- [ ] AC-1：A2A 私有消息渲染为私有气泡/投递回执行；不冒充公开回复。
- [ ] AC-2：multi-mention burst 归入一个汇总卡；target 回答可展开；不散落。
- [ ] AC-3：1440/390、浅色/深色截图一致；无布局回退。
- [ ] AC-4：operator 视觉验收；非作者 review。

## 证据

- **Clowder 参考路径**（相对参考仓根目录）：
  - `packages/web/src/components/ChatMessage.tsx`（气泡/direction pill）
  - `packages/web/src/lib/parse-direction.ts`（whisper/crossPost/mention）
  - `packages/web/src/components/thread-chat/single-cat-conversation-projection.ts`
  - `packages/web/src/components/thread-chat/ThreadChatSurface.tsx`
  - `packages/web/src/components/thread-chat/SingleCatConversationTimeline.tsx`
  - `packages/web/src/components/QueuePanel.tsx`
- 0007 §3.8 multi_mention aggregate、message lifecycle/extra。
- 0019 §3.5/§6 as-built 消息形态。
- F043 设计稿 `docs/design/F043/`（A+C）与 AC-4。

## 风险 / 回滚

- 前端展示层改动，风险低；不触碰后端数据。
- 若汇总卡信息不足，回退到私有气泡 + 可展开列表，不新增后端字段。

[宪宪/deepseek-flash🐾]
