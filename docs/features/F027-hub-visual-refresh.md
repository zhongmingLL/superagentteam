---
feature_ids: [superagentteam/F027]
related_features: [superagentteam/F020, superagentteam/F025, superagentteam/F026]
title: "F027: Hub visual refresh — light-blue rational workspace"
status: implemented
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: [墨墨 (Qwen 3.8 Flash)]
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-23
updated: 2026-11-23
source_decision: "operator 2026-11-23: 现有前端简陋；方向 A（Clowder 布局语法 + SuperAgentTeam 品牌），改为浅蓝理性氛围 + 侧边导航栏"
---

# F027: Hub visual refresh — light-blue rational workspace

## Why

F020–F026 把 Hub 的功能面做齐了：thread、消息、A2A live/queue、未读、
重命名、失败重试、agent 管理、本地直接访问。但页面仍是 React/CSS 手写的
功能壳：

- 侧栏只有文字列表，没有头像、状态、消息预览的层次；
- 消息是白底卡片 + 边框，没有 avatar、分组、user/agent 视觉区分；
- composer 只是一个 textarea + 按钮；
- thread header 只有标题和路径，没有成员、live/queue 的整合；
- 390px 只是把侧栏收起，排版没有重做。

operator 2026-11-23 明确要求先用 Pencil 出设计稿，并按 Clowder 的布局语法
重做；方向定为 **浅蓝理性氛围 + 侧边导航栏**，去掉暖色和衬线大标题。

## 用户结果

- 1440 桌面：左侧 72px 导航栏 + 280px thread 列表 + 主对话区；
  thread 标题/路径/成员、live/queue、pinned context、消息流、composer
  在同一视觉系统里可读、可扫。
- 390 移动：主对话视图 + 侧边抽屉；导航、thread 列表、消息流、composer
  在窄屏仍可用，不需要横向滚动。
- 浅色为默认；深色主题保持同一结构、对比度可读。
- 所有现有行为不回退：未读、重命名、失败重试、live/queue、
  cross-thread badge、multi-mention、草稿、401 重登、新建 thread。

## 范围

- Token 层：`packages/superagentteam-web/src/styles/tokens.css` 改为浅蓝
  理性色板；Inter 作为 display/body 字体，去掉衬线。
- Shell：新增桌面 nav rail；thread sidebar 重排；移动端抽屉导航。
- Thread 页：header（标题、重命名、projectPath、成员）、live/queue 状态条、
  pinned context、消息行（avatar/气泡/跨线程 badge）、composer 工具栏。
- Home：统一到同一套 hero/card 语言。
- 组件只改表现层；不新增 API、store 或 runtime 行为。

## 非目标

- 不新增 Tasks / Memory 页面；nav 中的入口保持 disabled，不做假页面。
- 不做附件上传；composer 只保留已实现的 @ 提及与目标选择。
- 不改消息协议、A2A runtime、queue/live 语义。
- 不引入第三方 UI/icon 依赖；图标用内联 SVG 或 CSS 形状，保持 bundle 轻量。

## 设计稿

Pencil 画布当前帧：

- `F027 · Desktop Thread View`（1440 × 1024）
- `F027 · Mobile Thread 390`（390 × 844）
- `F027 · Mobile Threads Drawer 390`（390 × 844）

导出的评审图：

- [desktop-thread-1440.png](../design/F027/desktop-thread-1440.png)
- [mobile-thread-390.png](../design/F027/mobile-thread-390.png)
- [mobile-drawer-390.png](../design/F027/mobile-drawer-390.png)

实现后的真实页面（2026-11-23，dev stack 3101，F025 数据副本）：

- [live-home-1440.png](../design/F027/live-home-1440.png)
- [live-thread-1440.png](../design/F027/live-thread-1440.png)
- [live-thread-390.png](../design/F027/live-thread-390.png)
- [live-drawer-390.png](../design/F027/live-drawer-390.png)
- [live-thread-390-dark.png](../design/F027/live-thread-390-dark.png)
- [live-light-1440.png](../design/F027/live-light-1440.png)（live 行 + unread 徽标）
- [live-dark-1440.png](../design/F027/live-dark-1440.png)（dark + live + unread）
- [live-dark-390-drawer.png](../design/F027/live-dark-390-drawer.png)（dark 抽屉 live/unread）

关键 token：

| Token | Light | 用途 |
|---|---|---|
| canvas | `#f8fbff` | 页面底色 |
| surface 1 | `#ffffff` | 消息/卡片 |
| surface 2 | `#f1f5f9` | 侧栏/次级面 |
| hairline | `#e2e8f0` | 发丝分隔 |
| ink | `#0f172a` | 标题 |
| body | `#334155` | 正文 |
| muted | `#64748b` | 次要信息 |
| primary | `#2563eb` | 主操作/active |
| agent A/B/C | `#2563eb` / `#0891b2` / `#7c3aed` | agent 区分 |

## 验收标准

- [x] 1440：nav rail + sidebar + 主区不溢出；消息、composer、live/queue 可见。
- [x] 390：抽屉可开合；主视图无横向滚动；composer 可输入/发送。
- [x] 浅色/深色主题均通过对比度与可读性目检。
- [x] `npm run typecheck`、`npm test`、`npm run build`（web workspace）通过。
- [x] 现有功能测试不回退：thread list/search/unread、rename、retry、
  cross-thread、multi-mention、composer send、401 relogin。
- [x] 浏览器 1440/390 截图作为验收证据。
- [x] sidebar live presence 保留可见「执行中」文字，不靠颜色单独表达。
- [x] 非作者 review（视觉 + 代码面）通过。

## 进展

- 2026-11-23：Pencil 出桌面 v2 + 390 主视图 + 390 抽屉；operator 已定
  「浅蓝理性氛围 + 侧边导航栏」方向。
- 2026-11-23：实现落地：浅蓝 token、桌面 nav rail + thread sidebar、移动
  抽屉、thread header/members/live/context、avatar 消息行、composer 工具栏、
  Home hero。保留全部现有 store/API 行为。
- 2026-11-23：验证：web typecheck + 88 tests + production build 全绿；
  Playwright 1440 / 390 / 390-dark 实测，无横向溢出、无 console error；
  composer @ 插入、主题切换、Agents 面板、移动抽屉均可用。
- 2026-11-23：墨墨 vision/UX review `changes_requested @ ea1b10d43`，唯一 P2
  为 sidebar live presence 被 visually-hidden 成只剩蓝点。已修：live 行显示
  「执行中」文字；空间不足时让时间戳让位，不让状态文字让位。P3-2 同步去掉
  header meta 与 pinned context 的重复成员计数。P3-1 补 live+unread 的
  light/dark 1440 与 dark 390 抽屉截图。
- 2026-11-23：operator 确认先合 F027；PR #167 merged as `de9e18061`。
  墨墨 P2/P3 已在 `6ff10c9ba` 全部闭合；CI 5/5 绿。状态更新为 implemented，
  等 operator close。
