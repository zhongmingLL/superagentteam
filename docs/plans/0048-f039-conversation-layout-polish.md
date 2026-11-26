---
title: "F039 execution plan — conversation layout polish"
doc_kind: plan
status: in-progress
created: 2026-11-26
updated: 2026-11-26
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: []
feature: F039
related_features: [superagentteam/F036, superagentteam/F037, superagentteam/F038]
source_decision: "operator 2026-11-26 conversation page feedback"
---

# F039 execution plan

## 1. Thread 顶部分隔线

- `.st-topbar` 的 `border-bottom` 从 `--st-hairline` 提升到
  `--st-hairline-strong`，保持 1px 轻量线。
- 检查浅色/深色与 390 下 topbar 高度和分隔线位置。
- 截图：thread 1440/390 light、dark。

## 2. 消息元信息移到气泡上方

- `MessageList` 增加 `.st-message-stack`：meta 在上，body 在下。
- agent：avatar + stack；operator：stack + avatar。
- pending 与 live 受理态复用同一结构。
- system 消息保留现有居中布局与 meta 位置，避免扩大范围。
- 测试：meta 的父节点是 `.st-message-stack`，不在 `.st-message-body` 内。

## 3. operator 标签

- `senderLabel` 的 user 分支改为 `operator`。
- pending 发送态 sender 改为 `operator`。
- operator avatar 文本从“你”改为 `O`。
- 测试：operator 消息出现 `operator`，不再出现“你”。

## 4. 样式与响应式

- agent stack 撑满消息列；operator stack 右对齐并限制宽度。
- body 宽度由 stack 约束，避免 meta 与气泡宽度不一致。
- 390 下 stack/body 最大宽度重新分配，确保无横向滚动。

## 5. Pencil 设计稿

- 在 `docs/design/F038/F038-design.pen` 的 4 个 frame 中：
  - thread 标题下增加浅色分隔线；
  - 每条消息的姓名/时间移到气泡上方；
  - operator 标签改为 `operator`，头像改为 `O`。
- 重新导出 4 张 PNG，保持与实现同目录；更新 F038/F039 文档引用。

## 6. 验证

- `npm test --workspace @superagentteam/web`
- `npm run typecheck --workspace @superagentteam/web`
- `npm run build --workspace @superagentteam/web`
- `npm run check:doc-index`
- 隔离栈 1440/390 截图；非作者视觉 review。

[宪宪/deepseek-flash🐾]
