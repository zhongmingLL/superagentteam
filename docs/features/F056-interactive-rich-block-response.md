---
feature_ids: [superagentteam/F056]
related_features: [superagentteam/F018, superagentteam/F031, superagentteam/F037, superagentteam/F055]
title: "F056: Interactive rich-block responses — 选项点击后返回给 agent"
status: implemented
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: []
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-28
updated: 2026-11-28
architecture_cell: "hub-action-surface + bubble-pipeline"
map_delta: "update required"
source_decision: "operator 2026-11-28: 之前开发的 rich-block 只是能够展示，不能够选择后返回（比如选某个方案后返回），参考 Clowder 设计，可复用则复用"
---

# F056: Interactive rich-block responses

> Runtime/A2A 强制预读：0005-thread-first-runtime、0007-a2a-runtime-chain、
> 0019-a2a-runtime-chain-as-built、F031（producer）与 `docs/reuse/hub-action-surface.md`。
> 本 feature 不新增第二套消息写路径，选择结果必须走 F018 ingress。

## Why

F029/F031 让 agent 能生产并展示 `interactive` 富块，但点击行为在 F031 里明确是
非目标（“interactive 只读，另立后续 feature”）。operator 现在要求：在 Hub 里选中
某个方案后，选择要能返回给 agent，让对话继续。

Clowder F096 的参考设计：

- `RichInteractiveBlock` = `interactiveType`（`select` / `multi-select` /
  `card-grid` / `confirm`）+ `options` + `messageTemplate` + `disabled` /
  `selectedIds`；
- 点击后由前端构造确定性的选择文本（`messageTemplate` 的 `{selection}` 或
  `我选了：…`），走**普通聊天消息**返回给 agent；
- 同时把 `disabled` / `selectedIds` 写回 block，防止重复提交；
- `OptionAction`（直接 callback endpoint）是另一条 F155 通道，本 feature 不做。

SAT 复用 block shape 与选择语义，但把 transport 适配成**一个服务端 action**：
message identity 与投递真相由服务端持有（bubble-pipeline 卡），客户端不直接写消息。

## 用户结果

- operator 在 agent 回复的 `interactive` 块里点选方案（或确认/取消、多选、
  card-grid、custom input），选择立即作为一条用户消息进入 thread 队列，agent
  能收到并继续回复。
- 提交后块显示已选状态并禁用；刷新、重连、换客户端后状态一致，不能重复提交。
- 失败（CSRF/已禁用/非法选择/队列满）有明确错误，不产生半条消息。

## 验收标准

- [ ] AC-1：`interactive` 块按 `interactiveType` 渲染可点击控件：select 单选确认、
      multi-select 多选确认（受 `maxSelect` 限制）、card-grid 网格选择、confirm
      确认/取消；选项支持 `description` / `emoji` / `customInput`。
- [ ] AC-2：提交后返回一条用户消息，内容由 block 的 `messageTemplate`
      （`{selection}`）/ title / option labels 确定性生成；默认目标走 F018 ingress
      隐式链（最近回复者优先），不硬编码 agent。
- [ ] AC-3：提交后 block 持久化 `disabled: true` + `selectedIds`；GET messages、
      刷新与实时刷新都能看到；重复提交返回 409 或幂等重放，不产生第二条消息。
- [ ] AC-4：`POST /api/messages/:messageId/rich-blocks/:blockId/respond` 是唯一
      写入口；session auth + CSRF + thread owner；非法 block/option/已禁用/未知
      interactiveType 都是 typed 4xx；不写入非法状态。
- [ ] AC-5：选择文本与校验是纯函数、可单测；customInput 有长度上限；生成文本
      不超消息正文上限。
- [ ] AC-6：Hub 1440/390 可用（无横向滚动）；等待态、错误态、已选态可见；
      按钮有可访问名称。
- [ ] AC-7：daemon API 测试、web 组件/测试、fullstack（真实 pi worker + mock
      provider）验证 agent 收到选择并继续回复；daemon full 与 web
      typecheck/tests/build 绿。

## 范围

### F056.1 契约与持久化

- shared types 补 `InteractiveType`、`InteractiveOption`、`RichInteractiveBlock`
  的类型视图（base `RichBlock` 仍保持开放，避免破坏 producer）。
- `MessageStore.updateRichBlockState(messageId, blockId, patch, now)`：只允许
  interactive block；合并 `disabled` / `selectedIds` 到 `extra.rich`，保留其他
  extra 字段，返回更新后的 block。
- 选择文本生成 + 选择校验为纯函数（`domains/rich-blocks/interactive-response.ts`）。

### F056.2 服务端 action

- `POST /api/messages/:messageId/rich-blocks/:blockId/respond`
  body `{ selectedIds: string[], customInput?: string }`。
- 流程：CSRF → thread owner → message/block 校验 → 生成文本 → ingress submit
  （确定性 messageId，幂等）→ 写 block 状态 → changeBus 发布。
- typed errors：`invalid_input` 400、`forbidden` 403、`message_not_found` /
  `block_not_found` 404、`block_disabled` / `already_responded` 409、
  `selection_invalid` / `interactive_unsupported` 422、`queue_full` 429。
- F055 telemetry：`superagentteam.rich_block.respond` span（HMAC ids），
  best-effort。

### F056.3 Hub 交互层

- `RichBlocks` 的 interactive 渲染改为可交互组件；`MessageList` 传入
  `messageId` 与 `onInteractiveRespond`；ThreadPage 接 chat store。
- `messageApi.respondToRichBlock` + `chatStore.respondToRichBlock`：
  提交 → 刷新消息/队列；按钮等待态与错误提示。
- 已 `disabled` 的块显示选中项但不可再点；未知 type 显示只读 fallback。

### F056.4 生产端提示更新

- `superagentteam_create_rich_block` 描述与 `superagentteam-rich-messaging`
  skill：interactive 现在可被点击，选择会以用户消息返回；保持 options 稳定 id、
  1–12 个、provide `messageTemplate` 时用 `{selection}`。

### F056.5 验证与证据

- daemon：selection builder 单测 + API route 测试（auth/CSRF/owner/校验/幂等/
  block 状态/消息内容/targets）。
- web：RichBlocks 交互测试（select/multi/card-grid/confirm/customInput/
  disabled/error）+ chat-store 测试。
- fullstack：真实 worker 产出 interactive block → respond API → 新 turn 收到
  选择文本并按 mock 回复；block state 持久。
- 1440/390 截图存 `docs/design/F056/`；隔离栈验收。

## 非目标

- `OptionAction` / 直接 callback endpoint（Clowder F155）；v1 只走聊天消息返回。
- per-user block 状态、撤销/重选、超时自动选择。
- approval / permission 交互块；跨 thread 转发；富块内嵌任意表单。
- 修改 F031 producer 的 block 校验语义（只补 interactive 的可交互提示）。

## 风险

- **重复提交**：block disabled 检查 + 确定性 messageId + ingress 幂等三层；
  并发双击最坏得到一次幂等重放或 409，不产生第二条消息。
- **状态竞态**：单条 SQLite 写入合并 block 状态；last-writer-wins，不触碰其他
  block/extra。
- **文本注入/超限**：选项 label 以纯文本渲染；提交文本由服务端生成，customInput
  与最终正文有上限；不执行 HTML。
- **越权**：CSRF + thread owner；message 必须在该 thread 且未删除。
- **队列满**：ingress 的 queue_full 原样映射 429，不写 block 状态。

## 依赖

- F018 ingress / queue / message store；F031 rich block producer 与 skill；
  F037 fullstack harness；F055 telemetry。

## 证据

- 报告：`docs/reports/2026-11-28-f056-interactive-rich-block-response.md`
- daemon：selection contract 7/7、API 4/4、fullstack 1/1；full **592 passed /
  5 skipped**
- web：interactive 组件 7/7；**29 files / 144 tests** + tsc/vite build 绿
- 隔离栈 3007/3016 实测：点击方案 B → 选择消息入队、block disabled、390
  `scrollWidth=390`；截图 `docs/design/F056/f056-interactive-{before,after}-1440.png`、
  `f056-interactive-390.png`
- 合入与部署：PR #282 merged `9af0b246f`；砚砚 approve @ `9930ad089`，CI 5/5；
  runtime 3005/3014 已重启到 `9af0b246f`，`/health.runningRevision` 一致，respond
  路由返回 typed 403/404，Web 已加载新 API 模块。

[宪宪/deepseek-flash🐾]
