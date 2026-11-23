---
title: "F029 execution plan — Hub message surface parity"
doc_kind: plan
status: accepted
created: 2026-11-24
updated: 2026-11-24
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
related: [features/F029-message-surface-parity.md, reuse/hub-action-surface.md, features/F027-hub-visual-refresh.md, features/F028-assistant-execution-record.md]
---

# F029 execution plan

## Goal

让 Hub 的消息面与 Clowder 的阅读语义对齐：agent 回复宽度稳定、A2A 收件人可见、
`extra.rich` 可展示；不改消息真相与投递账本。

## 切片

### F029.1 nameplate 宽度

- `MessageList`：agent 消息改为 nameplate 结构（avatar + meta + 全宽 body），
  用户消息保留右对齐 bubble，system 保持居中。
- `global.css`：新增 `.st-message-column` / `.st-message.is-agent` 规则；
  去掉 agent body 的收缩宽度与外框。
- 断言：agent article class、body 宽度类、user bubble 仍存在。

### F029.2 A2A dispatch 归属

- 在 agent/human 消息 meta 下增加 dispatch 行：target 名称 + 阶段
  （已送达 / 处理中 / 已回复），数据来自 `extra.targetAgentIds` 与
  `lifecycle.input.dispatchRefs`。
- 无 target / 无 lifecycle 时不渲染空行；cross-post 保留来源 thread badge。

### F029.3 rich block 展示

- 新增 `RichBlocks` 组件，按 `RichBlockKind` 分派；样式接 F027 token。
- card 的 body 复用现有 markdown 渲染；html_widget 用 sandbox iframe；
  media/file/audio 只读展示 URL；interactive 先只读。
- 未知 kind 显示 fallback；块数/媒体数/高度设上限。

### F029.4 验证

- web unit tests：nameplate/user/system、dispatch 行、rich block kinds/fallback。
- `npm test -w @superagentteam/web`、`npm run check:web`、`npm run build -w @superagentteam/web`。
- 浏览器 1440/390 light/dark；截图存 `docs/design/F029/`。

状态（2026-11-24）：F029.1–F029.4 完成；24 files / 99 tests pass，build 与
doc-index pass。富块生产端工具与 interactive action 留 Phase 2。

## 测试矩阵

| 层 | 用例 |
|---|---|
| web UI | agent 全宽 nameplate；user 右对齐；system 居中 |
| web UI | targetAgentIds + dispatchRefs → 收件人与阶段；无 target 不渲染 |
| web UI | 8 种 rich block 的渲染与未知 kind fallback |
| browser | 1440/390 light/dark；rich blocks 不横向溢出；无 console error |

## 回滚

纯 Hub 投影层变更，≤1 commit；不改 message / dispatch / rich 持久化。
