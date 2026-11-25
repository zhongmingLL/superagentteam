---
feature_ids: [superagentteam/F035]
related_features: [superagentteam/F030, superagentteam/F033]
title: "F035: Settings hub — sidebar entry + accounts/agents pages"
status: implemented
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: [墨墨 (Qwen 3.8 Flash), 砚砚 (GLM 5.3 Flash)]
created: 2026-11-25
updated: 2026-11-25
source_decision: "operator 2026-11-25: add Settings at the bottom of the sidebar; account/agent creation should live in settings pages, like Clowder"
---

# F035: Settings hub

## Why

当前账号管理和 agent 创建藏在 `AgentPopover` 的弹窗/二级弹窗里，入口在顶栏；operator 找不到稳定的设置入口。Clowder 把账号、agent 等配置收敛到独立设置页，侧边栏底部有固定入口。本 feature 把 SuperAgentTeam 的账号/agent 管理升级成可发现的设置页。

## 用户结果

- 侧边导航最下方有“设置”入口，任何页面都能进入。
- 设置页有清晰的账号、agent 管理区块；创建/编辑不再必须通过顶栏 popover。
- 账号创建、agent 创建、编辑、删除都有独立页面/面板，窄屏可用。
- 现有 popover 快捷入口保留或平滑迁移，不丢功能。

## 范围

- `/settings` 路由与布局；左侧设置导航（账号、Agents），右侧内容。
- 账号：列表、创建、编辑、删除（复用现有 `accountApi` 与凭据只写不回显约束）。
- Agents：列表、创建、编辑（复用 `AgentEditorModal` 的表单/校验）。
- 侧边栏（NavRail 底部 + ThreadSidebar 底部 profile 区域）加入设置入口。
- 视觉参考 Clowder 设置页的信息层级；遵循现有 `st-*` tokens。
- 测试：路由/导航、账号/agent 创建流程、窄屏、浏览器截图。

## 非目标

- 不新增后端设置能力；不改 accounts/agents 契约。
- 不实现 Tasks/Memory 设置（仍 disabled）。
- 不做全局主题/快捷键设置页（已有主题按钮保留）。

## 验收

- [x] AC-1：侧边栏底部设置入口可见、可键盘访问、窄屏可用。
- [x] AC-2：`/settings` 页面包含账号与 Agents 两个设置区块。
- [x] AC-3：账号创建/编辑/删除与 agent 创建/编辑在设置页可用，错误可读。
- [x] AC-4：现有顶栏 popover 入口不回归；无重复提交/状态不同步。
- [ ] AC-5：web tests + browser screenshots；3103 实机可完成一次账号/agent 创建。
- [ ] AC-6：设计稿 `.pen` 源文件入库后，逐项核对实现与设计稿一致（operator/墨墨验收）。

## 实现进展（2026-11-25）

- `/settings` 路由 + 两栏设置布局（账号 / Agents）；窄屏折叠为横向导航。
- `AccountsModal`、`AgentEditorModal` 增加 `variant="page"`：表单与校验仍是同一份实现，弹窗入口原样保留。
- `NavRail` 底部、`ThreadSidebar` profile 上方加设置入口；修正 Threads 导航项在非对话路由仍高亮的问题。
- 测试：`settings-page.test.tsx` 覆盖列表/页面编辑器/区块切换；`thread-sidebar.test.tsx` 覆盖设置链接。web 全量 101 passed。
- 2026-11-25：PR #196 merged `29f104852`（墨墨 vision/UX approve @ `723024d2e`，砚砚 aria/state approve @ `190662f21`，P3 全收）；CI 5/5；已部署 live `469e858ce`。
  墨墨用隔离栈补了 1440/390 真机截图 + 真实创建流程（网络证据 `{"accounts":[]}`，全程未触 live）；live 3103 的实机创建待 operator 签收。
- 2026-11-25（operator design feedback）：设置改为与 threads **平级的独立页面**——`AppShell` 在 `/settings` 不再渲染 ThreadSidebar 和 threads topbar；移除 ThreadSidebar 里的设置快捷入口（设置只属于左侧图标栏）。
  设置子导航按 Clowder 参考重做（图标 + 名称 + 说明 + 计数），Agents 行加头像；文案统一为「账户与登录 / Agents」。
  这一轮未走 Pencil 设计流程，是按 Clowder 结构参考 + 现有 `st-*` tokens 直接落地；后续大改视觉前先补设计稿。

## 设计稿（2026-11-25）

- `docs/design/F035/settings-accounts.png` — 设置 · 账户与登录
- `docs/design/F035/settings-agents.png` — 设置 · Agents
- `docs/design/F035/account-create.png` — 新建账号
- `docs/design/F035/agent-create.png` — 新建 Agent · 身份与职责（Role 在此段）
- `docs/design/F035/agent-create-account.png` — 新建 Agent · Account 与模型（分区导航第二态）
- 结构统一为：NavRail + 设置子导航（图标/说明/计数）+ 内容；设置与 threads 平级。
- Pencil 源文件 `docs/design/F035/F035-settings.pen`（画布已建，待 operator 保存后入库）。
- 2026-11-25（operator）：侧边栏移除 Agents 入口（NavRail 与 ThreadSidebar 均不再放 Agents），Agents 管理只在设置页；设计稿四屏同步去掉 rail 的 Agents。
- 2026-11-25（operator design feedback v2）：
  - 新建账号：移除 `ref` 字段（标识由系统生成）；Models 改为逐个添加的 chip + “添加 model”；删除表单分隔横线。
  - 新建 Agent：参考 Clowder 的“身份与职责 → 模型与工具”信息层级（配色仍用本产品 token）；id 不再手填（后台生成）；身份段含名字/呼叫别名/职责/头像/成员主色；第二段为 Account/Model/Role/启用。
  - 2026-11-25（operator v3）：Role 归入身份与职责；两段改为 Clowder 式左侧分区导航 + 单区内容（不再平铺），并补第二态设计图 `agent-create-account.png`。
- 2026-11-25（implementation）：agent/account create 不再要求手填 id/ref（服务端生成，碰撞重试）；agent 支持 avatar/color；账户 Models 改为逐项 chip 添加；Agent 表单改为身份（含 Role、头像、成员主色、呼叫别名）→ Account/模型两分区；表单采用 Clowder 式填充输入与轻阴影（保留冷色 token）。

[宪宪/deepseek-flash🐾]
