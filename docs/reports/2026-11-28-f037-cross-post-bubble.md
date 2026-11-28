---
title: "F037 acceptance — cross_post_message presentation"
doc_kind: report
status: active
created: 2026-11-28
updated: 2026-11-28
source_decision: "operator 2026-11-28: cross_post 投递消息太像本 thread 消息；去头像、sender→recipient 圆框、来源收进 sender 圆框、气泡内 cross_post_message + 发送目标下方横线"
---

# F037 acceptance — cross_post_message presentation

## 坐标

| 项 | 值 |
|---|---|
| fix PR | #268，reviewed HEAD `3a0490df4`；merge `dceb0f86e` |
| runtime | `/home/ming/agent/superagentteam-runtime` @ `dceb0f86e`；web `3005` / daemon `3014` |
| 隔离验证 | `3007/3016` + `/home/ming/.superagentteam-f037-e2e/data` |
| review | 墨墨 approve @ `3a0490df4`；P3 仅 390 header/time 换行审美，非阻塞 |

## BUG-F037-005（P2，Hub）— cross_post 消息看起来像本 thread 回复

- **现象**：跨线程投递的消息使用普通 agent nameplate + avatar，仅有一个小 badge；
  一眼看去像本 thread 的普通回复。
- **复现**：`F037 Hub E2E Renamed` → `F037 Cross Target` 的 cross_post（target f037b）。
- **期望（operator 两轮确认）**：
  1. 去掉头像；
  2. header 显示 `[sender ｜ 跨线程来自 <source thread>] → [recipient]`，来源收进
     发送者同一个圆框；
  3. 气泡内 `cross_post_message` → `发送给 xxx 已回复` → 横线 → 内容。
- **修复**：
  - 新增独立 crossPost 分支，`is-cross-post` + `is-agent-column`（38px + 80% 列）。
  - sender pill 内含可点击 source thread；recipient 取
    `targetAgentIds ∪ dispatchRefs(agent-kind)`；时间右对齐。
  - 气泡 body 使用 `cross_post_message` 标签、复用 `DispatchTargets`、横线、正文。
  - 删除普通 agent 分支的 cross badge，避免双重来源展示。
- **几何**：1440 head/body/agent `x=416, w≈817`；390 `x=54, w=274`；
  `scrollWidth=390=innerWidth`；无头像；source 在 sender pill 内。
- **截图**：
  - `docs/design/F037/ac5-cross-post-preview-1440.png`
  - `docs/design/F037/ac5-cross-post-preview-390.png`
  - `docs/design/F037/ac5-cross-post-runtime-1440.png`（runtime `dceb0f86e`）
- **状态**：fixed / deployed / verified。

## 验证

- web 25 files / 120 tests passed；tsc + vite build passed。
- PR #268 CI 5/5 @ `3a0490df4`；墨墨 approve。
- 隔离 3007/3016 真实 Kimi cross_post：target thread 收到消息，f037b 回复，
  source thread 可点击跳回。
- runtime `dceb0f86e`：`/health` revision 匹配，`runtime status --check-write` health true /
  write path ok；真实 `a2a-测试` cross_post 消息显示
  `Agent A ｜ 跨线程来自 a2a-测试2 → Agent B`，console errors 0。

## 说明

- 390 下 header 自然换行为两行，时间落在行尾；墨墨标记 P3 审美项，operator 未要求修改。
- 本次只改前端 projection/CSS；crossPost provenance 数据未变。

[宪宪/deepseek-flash🐾]
