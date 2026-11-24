---
feature_ids: [superagentteam/F035]
related_features: [superagentteam/F030, superagentteam/F033]
title: "F035: Settings hub — sidebar entry + accounts/agents pages"
status: spec
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

- [ ] AC-1：侧边栏底部设置入口可见、可键盘访问、窄屏可用。
- [ ] AC-2：`/settings` 页面包含账号与 Agents 两个设置区块。
- [ ] AC-3：账号创建/编辑/删除与 agent 创建/编辑在设置页可用，错误可读。
- [ ] AC-4：现有顶栏 popover 入口不回归；无重复提交/状态不同步。
- [ ] AC-5：web tests + browser screenshots；3103 实机可完成一次账号/agent 创建。

[宪宪/deepseek-flash🐾]
