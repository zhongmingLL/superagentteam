---
title: "F040 execution plan — thread row actions & header divider"
doc_kind: plan
status: in-progress
created: 2026-11-26
updated: 2026-11-26
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: []
feature: F040
related_features: [superagentteam/F037, superagentteam/F038, superagentteam/F039]
source_decision: "operator 2026-11-26 conversation list/header feedback"
---

# F040 execution plan

## 1. Thread row 更多操作

- `ThreadRow` 外层改为 `row-wrap`；`NavLink` 只包行内容，更多操作按钮作为兄弟节点，
  避免交互嵌套。
- 按钮 `aria-label="更多操作"`；菜单 `role="menu"`，当前只提供 `重命名对话`。
- 菜单打开时点外部/Escape 关闭；按钮 `aria-expanded` 同步。

## 2. 行内重命名

- 菜单点击后进入编辑态：标题替换为 input `aria-label="对话名"`。
- Enter 保存、Escape 取消；空标题不提交；保存中禁用输入。
- 失败在行内显示 `role="alert"`；成功后 store 的 `rename` 更新列表/详情。
- 编辑态使用非链接容器，避免 NavLink 导航。

## 3. Thread 页头部分隔线

- 移除 `ThreadPage` 的重命名 state/handler/form/link。
- `.st-topbar` 移除 `border-bottom`。
- header 后插入 `.st-thread-divider`，横跨 `.st-thread-page` 内容宽度。
- 保持项目路径/成员在 divider 上方，消息在下方。

## 3b. 侧栏标题去掉副标题

- `ThreadSidebar` 头部移除 `<p>{allThreads.length} conversations · local dev</p>`；
  只保留 eyebrow + `Threads`。
- 测试断言该副标题不存在。

## 4. 测试

- `thread-row`：更多操作菜单打开、重命名成功、Escape 取消、失败提示。
- `thread-page`：不再有重命名按钮；divider 在项目路径之后；消息仍在 divider 之后。

## 5. Pencil

- Thread 1440/390 删除 Topbar Divider；在 Meta Row 后插入 `Thread Header Divider`
  （`$hairline-strong`，宽度与聊天内容区一致）。
- Thread Row 1 增加 `ellipsis-vertical` 图标，表示更多操作。
- 重导出 4 张 PNG，更新 F039/F040 证据引用。

## 6. 验证

- `npm test --workspace @superagentteam/web`
- `npm run typecheck --workspace @superagentteam/web`
- `npm run build:offline`
- `npm run check:doc-index`
- 隔离栈 1440/390 浅色/深色截图；非作者视觉 review。

[宪宪/deepseek-flash🐾]
