---
feature_ids: [superagentteam/F036]
related_features: [superagentteam/F027, superagentteam/F028, superagentteam/F029]
title: "F036: Chat surface polish — agent message bubble and operator avatar"
status: implementing
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: [墨墨 (Qwen 3.8 Flash)]
created: 2026-11-25
updated: 2026-11-25
source_decision: "operator 2026-11-25: final agent content looks outside the bubble / bubble may share the chat background; operator has no avatar while agents do"
---

# F036: Chat surface polish

## Why

F029 为了消除“气泡随内容忽短忽长”，把 agent 消息改成了无外框的全宽 nameplate。
实机使用后 operator 读到的结果是：最终回复文字直接落在聊天背景上，看起来不在气泡里
（也确实没有气泡背景）；同时 user 气泡没有头像，只有 agent 有头像，身份呈现不对称。

这不是 F029 的回归——F029 的 nameplate 决策在它的目标下是正确的；F036 是在新反馈上
演进视觉契约。

## 用户结果

- agent 最终回复有可见的气泡/卡片表面，且保持全宽稳定，不回到流式抖动。
- operator 自己的消息（含发送中）有头像，位于右侧气泡外侧。
- light/dark、1440/390 一致；无后端或契约改动。

## 范围

- `MessageList`：user 消息与 pending 消息渲染 operator 头像（`你`，中性色）。
- `global.css`：agent nameplate body 恢复 surface-1 + hairline 边框 + 圆角 + padding，
  保留 `flex: 1 1 auto; width: 100%; max-width: 100%` 的宽度稳定行为。
- 测试：DOM 断言 user 头像存在、agent 消息仍带 `is-nameplate`；web typecheck/tests/build。

## 非目标

- 不改 F029 的宽度策略（不引入 fit-content / 按内容收缩）。
- 不做头像上传、图片头像或 per-agent 自定义头像。
- 不改消息存储、A2A 归属展示或 rich blocks。

## 验收

- [ ] AC-1：agent 消息有可见气泡表面，宽度仍全宽稳定。
- [ ] AC-2：user 消息与 pending 消息有 operator 头像，气泡保持右对齐。
- [ ] AC-3：1440/390、light/dark 截图；web typecheck/tests/build 与 CI 绿。

[宪宪/deepseek-flash🐾]
