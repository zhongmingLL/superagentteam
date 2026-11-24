---
feature_ids: [superagentteam/F029]
related_features: [superagentteam/F018, superagentteam/F020, superagentteam/F027, superagentteam/F028, superagentteam/F031]
title: "F029: Hub message surface parity — nameplate width, A2A dispatch attribution, rich blocks"
status: implemented
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: [墨墨 (Qwen 3.8 Flash)]
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-24
updated: 2026-11-24
source_decision: "operator 2026-11-24: 气泡长度忽短忽长；post_message 内容不该只是看起来像 agent 对用户说；rich block 是否实现、可全面复用 Clowder 设计"
---

# F029: Hub message surface parity

## Why

F027/F028 之后，operator 实机查看 Hub 提出三条消息面问题：

1. **气泡长度忽短忽长**：同一 thread 内 agent 气泡按内容收缩，短句很窄、长文很宽，
   视觉节奏不统一。
2. **post_message 的收件人不可见**：Agent A 发给 Agent B 的消息在 Hub 里只显示
   A 的头像和正文，看起来像 A 在对用户说话；缺少“发送给 B / B 是否在处理”的归属。
3. **rich block 是否实现**：Hub 尚未渲染 `message.extra.rich`；Clowder 的富块体系
   （card / diff / checklist / media_gallery / file / audio / html_widget /
   interactive）可以作为参考实现。

## Clowder 参考结论

- **消息呈现**：`MessageBubble` 有 `bubble` / `nameplate` / `human` 三种 presentation。
  cat 回复走 `nameplate`：占满阅读栏、无外层气泡边框；用户消息走 `human`：
  右对齐、最大约 80%、短消息自然收窄。agent 回复不再按内容收缩。
- **A2A 归属**：`message-dispatch-projection.ts` + `MessageDispatchAvatars.tsx`
  从 `lifecycle.dispatchRefs` 投影 target 的 delivered / processing / settled，
  在消息附近显示收件 agent 和投递进度，而不是让消息看起来像对用户说。
- **Rich blocks**：`extra.rich.blocks` 为独立于 `contentBlocks` 的展示层；
  `RichBlocks.tsx` 按 kind 分派到 CardBlock / DiffBlock / ChecklistBlock /
  MediaGalleryBlock / FileBlock / AudioBlock / HtmlWidgetBlock / InteractiveBlock。

## 用户结果

- agent 消息在阅读栏内宽度一致；用户消息保持右对齐气泡；system 消息居中。
- post_message / cross_post_message 的输入消息在 sender 之外显示“发送给 <agent>”
  与投递阶段；收件人身份来自 `extra.targetAgentIds`，阶段来自
  `lifecycle.input.dispatchRefs`。
- 带 `extra.rich` 的消息渲染富块；未知 kind 显示明确 fallback，不静默丢弃。

## 范围

### Phase 1（本 feature）

- F029.1：agent 消息 nameplate 呈现（全宽、去外框），用户气泡保持右对齐。
- F029.2：A2A 收件人 / dispatch 阶段展示。
- F029.3：rich block 展示层（card / diff / checklist / media_gallery / file /
  audio / html_widget；interactive 先只读展示）。
- F029.4：DOM/CSS 断言 + 1440/390 光暗截图 + 现有测试不回退。

### 非目标

- 富块的生产端工具（agent 如何在回复里创建 rich block）留到 Phase 2，由 F031 承接；
  本 phase 只消费已持久化的 `extra.rich`。
- interactive 的真实发送 / callback action、文件上传、TTS 生成、富块转发。
- Clowder 的 per-cat OKLCH、nameplate 的 breed 视觉、rich block 动作运行时。

## 验收标准

- [x] agent 消息不再按内容收缩；1440/390 下宽度一致。
- [x] 用户消息仍右对齐、短消息自然收窄；system 消息居中。
- [x] post_message 输入消息显示 target agent 与投递阶段；无 target 的消息不显示空行。
- [x] card/diff/checklist/media_gallery/file/audio/html_widget 可渲染；
      未知 kind 有 fallback；大字段/长列表有边界。
- [x] web typecheck/tests/build 全绿；浏览器无 console error。
- [x] 1440/390、light/dark 截图存 `docs/design/F029/`。

## 进展

- 2026-11-24：F029.1–F029.3 实现并通过实机验证。agent 消息改为 nameplate
  （全宽、去外框）；A2A 输入消息显示 `发送给 <agent> · 已回复`（target
  优先取 `extra.targetAgentIds`，回退 `lifecycle.dispatchRefs`）；
  `RichBlocks` 展示 card / diff / checklist / media_gallery / file / audio /
  html_widget / interactive（只读），未知 kind 有 fallback。
- 验证：web typecheck pass；24 files / 99 tests pass；production build pass；
  doc-index pass。截图见 `docs/design/F029/`。
- 2026-11-24：墨墨 vision/UX approve @ `79d400546`，P3（diff 行级红绿染色）
  已补：`+` / `-` / `@@` 行分别着色，并加回归断言。
- 2026-11-24：P3 delta 确认延伸 approve 至 `e44825788`；PR #172 merged as
  `493aa01c3`。CI 5/5 绿；状态更新为 implemented，等 operator close。

## 风险与回滚

- **呈现变更**：只改 Hub 投影层，不动 `messages` / `dispatchRefs` / `extra.rich`
  真相；回滚 ≤1 commit。
- **富块安全**：html_widget 用 sandbox iframe；媒体 URL 只读展示；不执行
  interactive action；文本沿用现有 markdown 渲染与脱敏路径。
- **兼容性**：没有 `extra.rich` 的消息走原路径；未知 block 显示 fallback。
