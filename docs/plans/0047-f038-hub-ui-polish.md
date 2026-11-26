---
title: "F038 execution plan — Hub UI acceptance polish"
doc_kind: plan
status: done
created: 2026-11-26
updated: 2026-11-26
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: []
feature: F038
related_features: [superagentteam/F027, superagentteam/F029, superagentteam/F034, superagentteam/F035, superagentteam/F036]
related: [features/F038-hub-ui-polish.md, ../DESIGN.md]
source_decision: "operator 2026-11-26 UI feedback during F037 acceptance"
---

# F038 execution plan

## 1. 去重 plus

- `ThreadSidebar` 新对话按钮保留 `<Icon name="plus">`，文字改为 `新对话`。
- 空态文案 `点「+ 新对话」开始` 改为 `点「新对话」开始`。
- 测试：按钮 accessible name 为 `新对话`；空态文案不再含 `+`。

## 2. Thread 页头部

- `AppShell` topbar：active thread 时只渲染 `.st-topbar-title`，移除 `Threads` Link
  与 chevron；无 active thread 时保留 `Threads` 入口。
- `ThreadPage`：移除内容区 `<h1>{thread.title}</h1>`；把项目路径、成员、重命名合并为
  一行紧凑 meta；重命名表单仍在原位。
- 删除 `.st-thread-context` 条（`线程上下文` / `本页 N 条消息` / `pinned context`）；
  它没有交互能力，避免误导。
- 测试：ThreadPage 不再出现重复 heading；项目路径/重命名/成员仍在；context 条不存在。

## 3. 停止按钮

- 移除 thread 顶部 `st-thread-status-row` 的 LivePill。
- 在 `MessageList` 之后、`QueueStrip`/`Composer` 之前渲染一个 status row，只放
  LivePill（含停止）；无 live 时整行不渲染。
- `stopError` 跟着移到同一区域；QueueStrip 仍显示队列。
- 测试：live 时 `停止 <agent>` 位于 composer 之前；无 live 时不渲染；点击仍调用
  `cancelAgent`。

## 4. 导航/Settings 统一

- `NavRail`：`设置` → `Settings`。
- `ThreadSidebar` mobile nav：`设置` → `Settings`。
- `SettingsPage`：h1 `设置` → `Settings`；返回链接 `← 返回对话` → `← Back to threads`；
  aria label `设置导航` → `Settings navigation`；tab `账户与登录` → `Accounts`。
- `AccountsModal` 标题 `账户与登录` → `Accounts`。
- CSS：`.st-settings-eyebrow` 对齐 `.st-sidebar-eyebrow`（primary/8px/600）；
  `.st-settings-brand h1` 对齐 `.st-sidebar-heading h2`（display/17px/600）。
- 测试：NavRail/mobile nav Settings；Settings 页 heading Settings；Accounts tab 可切换。

## 5. 验证

- `npm test --workspace @superagentteam/web`；`npm run typecheck --workspace @superagentteam/web`；
  `npm run build --workspace @superagentteam/web`。
- 隔离栈 3007/3016：1440/390 light/dark 截图；运行中停止按钮在输入框上方；thread 页
  无重复标题/无 context 条；Settings 头部与 Threads 一致。
- 非作者 review（墨墨）覆盖最终实质 HEAD；docs/BACKLOG 同步。

## 6. 进展

- 4 点均已落地；`AccountModal` 标题、`AgentEditorModal` 空账号引导同步为 `Accounts`。
- LivePill 位于 QueueStrip 之后、Composer 之前；无 live 时整行不渲染。
- web 110 passed；typecheck/build/`npm run check` 绿；1440/390 截图通过。
- 非作者 review：墨墨 approve `3f3f36c9a`；CI 5/5。
- PR #215 landed `e3700094b28cd6b09e97a971f11b20e7b640d039`。
- 剩余：operator 验收。

[宪宪/deepseek-flash🐾]
