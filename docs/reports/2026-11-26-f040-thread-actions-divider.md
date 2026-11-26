---
title: "F040 Thread row actions & header divider — verification report"
doc_kind: report
status: in-progress
created: 2026-11-26
updated: 2026-11-26
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
feature: F040
related_features: [superagentteam/F037, superagentteam/F038, superagentteam/F039]
source_decision: "operator 2026-11-26: thread 编辑收进更多操作菜单；分隔线下移到项目路径下方；侧栏 conversation count 副标题移除"
---

# F040 Thread row actions & header divider

## 结论

operator 的三条后续反馈已落地，消息/A2A/队列/取消语义未改：

1. thread 列表行新增“更多操作”菜单；重命名从 thread 页移入行内编辑。
2. 分隔线从 topbar 下移到项目路径行之后，横向覆盖聊天内容区。
3. 侧栏标题下的 `N conversations · local dev` 副标题移除。

Pencil 设计源与 4 张导出图已同步。

## 1. Thread 行更多操作

每行右侧有 `更多操作` 按钮；菜单提供 `重命名对话`，点击后标题变为行内输入框。
Enter 保存、Escape 取消；失败在行内显示错误。

![sidebar more actions: 1440](../design/F040/sidebar-menu-1440.png)

![sidebar inline rename: 1440](../design/F040/sidebar-rename-1440.png)

390 下更多操作按钮常显，避免 hover-only 交互在触屏不可用：

![sidebar: 390](../design/F040/sidebar-390-light.png)

## 2. Thread 页头部分隔线

`ThreadPage` 移除“重命名”入口；`.st-topbar` 不再画线；项目路径/成员保留在
`.st-thread-header`，header 之后渲染 `.st-thread-divider`，横跨聊天内容区。

![thread header divider: 1440 light](../design/F040/thread-1440-light.png)

![thread header divider: 1440 dark](../design/F040/thread-1440-dark.png)

![thread header divider: 390 light](../design/F040/thread-390-light.png)

## 3. 侧栏副标题

`ThreadSidebar` 头部只保留 `SUPERAGENTTEAM` eyebrow 与 `Threads` 标题，不再显示
`N conversations · local dev`。

## 验证

| 命令 | 结果 |
|---|---|
| `npm test --workspace @superagentteam/web` | 116 passed（25 files） |
| `npm run typecheck --workspace @superagentteam/web` | pass |
| `NODE_ENV=development npm run build:offline` | pass |
| `npm run check:doc-index` | pass（50 feature docs / 40 BACKLOG rows） |
| 1440/390、浅色/深色视觉 | 菜单/输入框可用；分隔线在项目路径后；无横向滚动 |
| Pencil 设计源 | 4 frames / 365 nodes / 61 variables；4 张 PNG 重新导出 |

## 边界

- 未新增 thread 删除/归档/收藏等后端能力；菜单只放当前已有的重命名。
- 未改消息、A2A、队列、取消或 rich block 语义。
- 正式栈 3005/3014 未操作；验证在隔离 3007/3016。

[宪宪/deepseek-flash🐾]
