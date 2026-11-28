---
title: "F037 acceptance — A2A reply visibility & bubble layout"
doc_kind: report
status: active
created: 2026-11-28
updated: 2026-11-28
source_decision: "operator 2026-11-28 验收：multi-mention agents 消息结束后消失；multi-mention/post_message 气泡需与 agent 气泡对齐，post_message 气泡内标 post_message + 横线"
---

# F037 acceptance — A2A reply visibility & bubble layout

## 坐标

| 项 | 值 |
|---|---|
| fix PR | #266，reviewed HEAD `01f8c7d49`；merge `7fe438118` |
| runtime | `/home/ming/agent/superagentteam-runtime` @ `7fe438118`；web `3005` / daemon `3014` |
| 隔离验证 | `3007/3016` + `/home/ming/.superagentteam-f037-e2e/data` |
| review | 墨墨 approve @ `01f8c7d49`（final design），P3 仅缺 390 截图（本报告补齐） |

## BUG-F037-003（P2，Hub）— multi-mention target 回复结束后从时间线消失

- **现象**：multi-mention 运行中能看到 A/B/C 的回复气泡；aggregate 到达后过一会，回复
  从主时间线消失，只剩汇总卡。
- **复现**：打开含 aggregate 的 thread（如 `F037 Hub E2E Renamed` / `a2a-测试2`），
  对比运行中与完成后的消息列表。
- **期望**：target 的回复作为正常 agent 消息保留；汇总卡只做摘要。
- **根因**：`MessageList` 收集 aggregate 的 `responseMessageId` 到 `hiddenResponseIds`，
  并把对应消息从 `visibleMessages` 过滤掉。运行中 aggregate 尚未带 responses，所以可见；
  完成后 responses 落库，回复被隐藏。
- **修复**：删除 `hiddenResponseIds` / `visibleMessages` 过滤，直接渲染 `messages`。
- **回归**：`message-list.test.tsx` 的响应可见断言由 `null` 翻转为 `not.toBeNull`；
  隔离栈 aggregate 后仍存在 `resp:...:f037b:1` / `f037c:1` article。
- **状态**：fixed / deployed / verified。

## BUG-F037-004（P2，Hub）— private A2A / multi-mention 气泡未与 agent 气泡对齐

- **现象**：`post_message` 气泡比 agent 气泡左移约 38px；multi-mention 汇总卡居中且更宽；
  `post_message` 气泡内没有明确的工具标签与分隔。
- **期望（operator 两点收敛）**：保留修改前结构；1) 气泡位置与 agent 气泡对齐；
  2) 气泡内加 `post_message` + 横线隔离，再内容。
- **根因**：private 分支没有 avatar 列偏移/80% 列宽；multi-mention card
  `max-width: 900px` + `margin: 0 auto` 居中；private head/body 另用 760px/82% 宽度。
- **修复**：
  - private / multi-mention 统一 `is-agent-column`：38px 偏移 + 80% 列宽；
  - private 保留原 sender → recipient 头部、气泡 body、delivery footer，不加头像；
  - body 内新增 `post_message` 标签 + `role="separator"` 横线；
  - multi-mention card 填满同一列，不再居中。
- **几何证据**：
  - 1440：agent body / private head / private body / multi-mention card 全部
    `x=416, w≈817`；
  - 390：全部 `x=54, w=274`，`scrollWidth=390=innerWidth`；private 无 avatar。
- **截图**：
  - `docs/design/F037/ac5-before-post-message.png`
  - `docs/design/F037/ac5-after-post-message.png`（1440）
  - `docs/design/F037/ac5-after-post-message-390.png`（390）
  - `docs/design/F037/ac5-after-multi-mention.png`
- **状态**：fixed / deployed / verified。

## 验证

- `npm test --workspace @superagentteam/web`：25 files / 120 tests passed。
- `npm run build --workspace @superagentteam/web`：tsc + vite build passed。
- PR #266 CI 5/5 @ `01f8c7d49`；墨墨 approve。
- runtime `7fe438118`：`runtime status --check-write` health true / write path ok；
  `/health` `runningRevision=7fe438118`。
- runtime UI：private/card/agent `x=416, w=817`；`post_message` 标签 + separator 存在；
  console errors 0。

## 说明

- target 回复气泡与汇总卡内摘要同时存在；墨墨 review 判定为“保留可见 + 卡存在”的
  operator 要求形态，不是回归。
- 本修复纯前端 projection/CSS；无 DDL/API/后端语义变化。

[宪宪/deepseek-flash🐾]
