---
feature_ids: [superagentteam/F038]
related_features: [superagentteam/F027, superagentteam/F029, superagentteam/F034, superagentteam/F035, superagentteam/F036, superagentteam/F037]
title: "F038: Hub UI acceptance polish"
status: implemented
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: []
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-26
updated: 2026-11-26
source_decision: "operator 2026-11-26: 新建对话两个+；thread 页去掉 Threads > 与重复标题；停止按钮移到输入框上方；左侧设置改英文并与 settings 头部统一"
---

# F038: Hub UI acceptance polish

## Why

operator 在 F037 验收时给了 4 个具体 UI 反馈：

1. 侧栏“新建对话”同时有 plus icon 和文字里的“+”，出现两个加号。
2. thread 页顶部 `Threads >` 面包屑和内容区大标题重复；内容区标题可以去掉。
   中间的“线程上下文 · 本页 N 条消息 · pinned context”没有清楚的作用。
3. agent 运行中的“停止”按钮在页面顶部，不好找；应该放到输入框上方，参考 Clowder。
4. 左侧导航“设置”还是中文，与 Threads/Tasks/Memory/Theme 不一致；Settings 页顶部
   的 `SUPERAGENTTEAM` 与 Threads 头部样式也不一致。

这些都是操作者可见的布局/文案问题，不改 A2A、队列、取消或重命名语义。

## 用户结果

- 新建对话只有一个 plus；空态文案不再写“+ 新对话”。
- thread 页只保留顶部 thread 名；内容区不再重复大标题；无作用的线程上下文条移除。
- agent 运行时，输入框上方出现运行态与“停止”按钮；点击后 live 清空、消息显示“已取消”。
- 左侧导航统一英文：Threads / Tasks / Memory / Theme / Settings；Settings 页标题为
  `Settings`，与 Threads 头部使用同一套 eyebrow + title 样式。

## 范围

- `ThreadSidebar`：新对话按钮去重 plus；空态文案同步。
- `AppShell`：active thread 时 topbar 只显示 thread 名，不显示 `Threads >` 面包屑。
- `ThreadPage`：移除重复 h1；保留项目路径、成员、重命名；移除 thread context 条；
  将 LivePill（含停止）移到 Composer 上方。
- `NavRail` / `ThreadSidebar` / `SettingsPage` / `AccountsModal`：Settings/Accounts
  英文标签与头部样式统一。
- 测试：web unit 覆盖 plus、topbar、重复标题、停止位置、Settings 英文标签。
- 截图：1440/390 light/dark，运行中停止按钮在输入框上方。

## 非目标

- 不改 A2A/queue/cancel API 或状态机。
- 不改 rename 行为；只移动重命名入口的视觉位置。
- 不做新的 pinned context 功能；无作用的占位条直接移除。
- 不做全局 i18n；只统一顶层导航与 Settings 主标题。

## 验收

- [x] AC-1：新建对话按钮只有一个 plus；空态文案不再出现“+ 新对话”。
- [x] AC-2：thread 页 topbar 不再出现 `Threads >`；内容区不再重复 thread 标题；
      thread context/pinned 条移除。
- [x] AC-3：运行中停止按钮位于输入框上方；点击后取消行为与 F034 一致；无 live 时不显示。
- [x] AC-4：NavRail 与移动导航显示 `Settings`；Settings 页标题 `Settings`，头部样式
      与 Threads 一致；Accounts 标签统一英文。
- [x] AC-5：web tests/typecheck/build 绿；1440/390 light/dark 截图；非作者 review 覆盖最终 HEAD。

## 风险

- 移除内容区 h1 会影响依赖 `heading Alpha` 的测试和重命名入口位置；保留 rename 功能并有测试。
- LivePill 移到 Composer 上方后，长消息/滚动区域变短；390 下需确认无横向滚动。
- Settings 翻译只改顶层标签，避免把现有中文说明全部改掉造成范围膨胀。

## 进展（2026-11-26）

- 4 点全部实现：plus 去重、thread 头部精简、LivePill 移到 Composer 上方、
  Settings/Accounts 英文与头部统一。
- 验证：web 110 passed / typecheck / build / `npm run check` 全绿；1440/390 截图。
- 证据与 before/after：`docs/reports/2026-11-26-f038-hub-ui-polish.md`；
  截图 `docs/design/F038/`。
- Pencil 页面设计：`docs/design/F038/F038-design.pen`（4 个 frame / 351 nodes /
  60 variables）+ 4 张 1440/390 导出图，和实现截图放在同一目录。
- 非作者 review：墨墨 approve `3f3f36c9a`；独立复核 web 110 / typecheck / build /
  doc index / CI 5/5。
- PR #215 landed `e3700094b28cd6b09e97a971f11b20e7b640d039`；F038 进入
  `superagentteam-work`。
- 剩余：operator 验收。

[宪宪/deepseek-flash🐾]
