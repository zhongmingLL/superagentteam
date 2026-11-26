---
feature_ids: [superagentteam/F040]
related_features: [superagentteam/F037, superagentteam/F038, superagentteam/F039]
title: "F040: Thread row actions & header divider placement"
status: in-progress
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: []
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-26
updated: 2026-11-26
source_decision: "operator 2026-11-26: 编辑去掉，thread 所有编辑（更多操作）和 Clowder 截图一致；分隔线画到聊天框左侧，项目路径在线上方"
---

# F040: Thread row actions & header divider placement

## Why

F039 合并后，operator 在验收时又给了两条修正：

1. thread 页内的“重命名”入口应该去掉；所有 thread 编辑都收进 thread 列表行的
   “更多操作”菜单，和 Clowder 的交互一致。
2. 分隔线不应该紧贴 thread 标题；应下移到项目路径行下方，并横向铺到聊天区左侧。
3. 侧栏标题下的 `3 conversations · local dev` 副标题不要了。

这两条是 thread 导航与对话页头部的布局修正，不改消息、A2A、队列、取消语义。

## 用户结果

- thread 列表每行右侧有“更多操作”按钮；菜单里提供 `重命名对话`，点击后在行内编辑标题。
- thread 页头部不再有“重命名”按钮或重命名表单；项目路径/成员保留。
- thread 页头部在项目路径行下方有一条浅色分隔线，横向覆盖聊天内容区；
  topbar 不再单独画线。
- 侧栏头部只保留 `SUPERAGENTTEAM` eyebrow 与 `Threads` 标题，不再显示
  `N conversations · local dev`。
- 1440/390、浅色/深色一致；Pencil 设计稿同步。

## 范围

- `ThreadRow`：新增更多操作按钮、菜单、行内重命名（Enter 保存 / Escape 取消）、错误提示。
- `ThreadPage`：移除重命名 state/form/link；在 header 后渲染 `.st-thread-divider`。
- `ThreadSidebar`：移除标题下的 conversation count / local dev 副标题。
- `global.css`：topbar 去 border；新增 thread menu / inline rename / divider 样式；
  移除不再使用的 rename form 样式。
- 测试：thread row 菜单与重命名；thread page 不再有重命名入口、divider 位于项目路径之后。
- Pencil：Thread 1440/390 移除 topbar divider，新增 meta row 后的 divider；
  Thread Row 1 增加更多操作图标；重导出 PNG。

## 非目标

- 不新增 thread 删除/归档/收藏等后端能力；菜单只放当前已有的重命名。
- 不改 thread 创建、消息、A2A、队列、取消或 rich block。
- 不做全局 i18n。

## 验收

- [x] AC-1：thread 行有“更多操作”按钮；菜单可打开/关闭，菜单位置不遮挡行内容。
- [x] AC-2：菜单中的“重命名对话”进入行内编辑；Enter 保存、Escape 取消；失败有可见错误。
- [x] AC-3：thread 页不再出现“重命名”按钮或重命名表单；项目路径/成员保留。
- [x] AC-4：分隔线位于项目路径行之后，横向覆盖聊天内容区；topbar 不再单独画线。
- [x] AC-5：1440/390、浅色/深色截图通过；无横向滚动。
- [ ] AC-6：web tests / typecheck / build / doc-index 绿；非作者视觉 review。
- [x] AC-7：Pencil 设计源与 4 张导出图同步更新。
- [x] AC-8：侧栏头部不再出现 `N conversations · local dev` 副标题。

## 风险

- 更多操作按钮在行内可能与时间/未读徽章抢空间；用右侧留白与 hover/focus 可见性控制。
- 行内重命名需要避免 NavLink 导航；编辑态用非链接容器承载输入框。
- 分隔线下移后，长消息滚动区域高度变化；保留置底逻辑并做截图验证。

## 进展（2026-11-26）

- 实现：`ThreadRow` 增加更多操作菜单/行内重命名；`ThreadPage` 移除重命名入口并在
  项目路径行后渲染 `.st-thread-divider`；`ThreadSidebar` 去掉 conversation count 副标题。
- 样式：topbar 去 border；更多操作按钮 hover/focus 可见，移动端常显；菜单/输入框/错误态。
- 测试：thread-page / thread-sidebar / thread-row 定向 17 passed；待跑全量。
- 视觉：`docs/design/F040/` 下 sidebar menu、inline rename、1440/390 浅色/深色。
- Pencil：Thread 1440/390 顶部分隔线移除，Thread Header Divider 下移到 meta row 后；
  Sidebar Sub 移除；Thread Row 1 增加更多操作图标；4 张 PNG 重导出。
- 证据：`docs/reports/2026-11-26-f040-thread-actions-divider.md`。
- 剩余：全量验证与非作者 review。

[宪宪/deepseek-flash🐾]
