---
title: "F056 执行报告：Interactive rich-block responses"
doc_kind: report
status: active
created: 2026-11-28
updated: 2026-11-28
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
feature: "docs/features/F056-interactive-rich-block-response.md"
---

# F056 执行报告：Interactive rich-block responses

## 需求

operator 2026-11-28：之前的 rich block 只能展示，不能选择后返回（例如选某个
方案后返回）；参考 Clowder 设计，可复用则复用。

## 参考设计（Clowder F096）

- `RichInteractiveBlock`：`interactiveType`（select / multi-select / card-grid /
  confirm）、`options`、`messageTemplate`、`disabled`、`selectedIds`。
- 点击后构造确定性选择文本（`{selection}` 模板或 `我选了：…`），走普通聊天消息
  返回给 agent；并把 `disabled` / `selectedIds` 写回 block。
- `OptionAction`（F155，直接 callback endpoint）不在本 feature 范围。

## 实现

### 契约与持久化

- `packages/superagentteam-shared/src/types/message.ts`：新增
  `InteractiveType` / `InteractiveOption` / `RichInteractiveBlock` 类型视图；
  `MAX_INTERACTIVE_OPTIONS=12`、`MAX_INTERACTIVE_CUSTOM_INPUT=500`。
- `MessageStore.updateRichBlockState`：仅允许 interactive block，合并
  `disabled` / `selectedIds` 到 `messages.extra.rich`，保留其他 extra/block。

### 选择语义（纯函数）

`domains/rich-blocks/interactive-response.ts`：

- `parseInteractiveBlock`：默认 type=select；校验 options（1–12、id 唯一、
  label 非空）。
- `validateInteractiveSelection`：id 存在性、去重、`maxSelect`、
  select/card-grid/confirm 恰好 1 个。
- `buildInteractiveResponseText`：confirm 的 确认/取消 文案、`{selection}`
  模板、emoji/label、title 后缀、customInput（仅选中项声明 customInput 时）；
  文本上限 4000。

### API

`POST /api/messages/:messageId/rich-blocks/:blockId/respond`
（`api/routes/message-actions.ts`）：

- CSRF + thread owner；message/block 校验；disabled → 409 `block_disabled`。
- 生成文本 → F018 ingress submit（确定性 messageId，幂等）→ 写 block state →
  changeBus 发布。
- typed errors：`interactive_invalid` / `interactive_unsupported` /
  `selection_invalid` / `custom_input_too_large` 422；`already_responded` /
  `block_disabled` 409；`message_not_found` / `block_not_found` 404；
  `csrf_failed` 403；`queue_full` 429。
- F055 telemetry：`superagentteam.rich_block.respond` span（thread/user/message/
  block HMAC + interactive.type）。

**与 Clowder 的有意差异**：Clowder 由前端 send + PATCH block-state 两步完成；
SAT 把两者收成一个服务端 action，因为 message identity 与投递真相由服务端持有
（bubble-pipeline R1），客户端不直接写消息。block state 仍是 message 级共享
（SAT 单 operator），与 Clowder 语义一致。

### Hub

- `RichBlocks` 的 interactive 改为可交互组件：select/multi-select/card-grid/
  confirm、customInput、maxSelect、选中/禁用/错误/等待态；无 handler 或未知
  type 显示只读 fallback。
- `MessageList` / `ThreadPage` 透传 `onRichBlockRespond`；`messageApi` +
  `chatStore.respondToRichBlock` 提交并刷新（先本地 patch 再 refresh）。
- 390 下 options/card-grid 自适应，无横向滚动；按钮带 `aria-pressed` /
  可访问名称。

### 生产端提示

- `superagentteam_create_rich_block` 描述与 `superagentteam-rich-messaging`
  skill：interactive 现在可点击，选择以用户消息返回；保持 1–12 个稳定 options，
  需要固定文案时用 `messageTemplate` 的 `{selection}`。

## 验证

- `f056-interactive-response.test.ts`：7/7（parse/validation/text/customInput/
  confirm）。
- `f056-rich-block-respond-api.test.ts`：4/4（成功投递+状态持久、customInput、
  409/403/422/404 typed errors、非 interactive/超限）。
- `f056-interactive-rich-block-fullstack.test.ts`：1/1（真实 pi worker + mock
  provider：agent 产 interactive block → operator respond → 第二轮收到
  `我选了：方案 A（选一个方案）` 并回复 CHOICE_RECEIVED；block disabled；
  重复提交 409；respond span 存在且 block.id 为 HMAC）。
- `rich-blocks-interactive.test.tsx`：7/7（select/multi/card-grid/confirm/
  customInput/disabled/error/read-only）。
- chat store：新增 respond 用例；daemon full **592 passed / 5 skipped**；
  web **29 files / 144 tests** + tsc/vite build 绿。

## 隔离栈视觉验收

- 隔离 daemon 3016 + vite 3007，独立数据 `/tmp/f056-acceptance/data`，
  `pollIntervalMs` 拉大避免触发 worker。
- 通过 API 创建 thread 并投递带 interactive block 的消息；浏览器打开真实入口
  `http://localhost:3007/thread/...`。
- 点击「方案 B」→「确认选择」：block 立即变为 disabled、方案 B 高亮、
  出现「已提交选择」；新用户消息
  `我选了 🅱️ 方案 B，请继续（选一个方案）` 进入队列（2/5）。
- GET `/api/messages` 复核：原消息 block `disabled=true, selectedIds=["b"]`；
  新消息内容与 UI 一致。
- 1440 截图：`docs/design/F056/f056-interactive-before-1440.png`、
  `f056-interactive-after-1440.png`；390 截图：
  `f056-interactive-390.png`，`scrollWidth=390`（无横向滚动）。

## 合入与部署

- PR #282 merged `9af0b246fdd56cb867182d829630beb5b156bad4`（base
  `superagentteam-work`）。
- 非作者 review：砚砚 approve @ `9930ad089`，无 P1/P2；CI run `46134407881`
  headSha 逐字一致，5/5 pass。
- 附带 test-only 修复：F046 `multi_mention` E2E 的 wait 条件从“消息可见”改为
  “callback 终态 completed”（+ fresh re-read），消除两次 CI 命中的既有 flake；
  已在 PR body 披露。
- 部署：`/home/ming/agent/superagentteam-runtime` checkout 并重启到
  `9af0b246f`；`/health.runningRevision` 逐字一致（bootSequence 79）。
- 部署核验（真实 runtime 3005/3014）：
  - 无 CSRF 的 respond 请求 → `403 csrf_failed`；带 CSRF 的未知 message →
    `404 message_not_found`（证明新路由已注册且 typed error 生效）。
  - Web `GET /src/domains/chat/api.ts` 含 `rich-blocks` 路径，`/` 200。

## 已知限制

- 选择是终局：提交后 block disabled，不做撤销/重选；重复提交 409。
- block state 是 message 级共享状态，不做 per-user。
- 不支持 `OptionAction` 直接回调 endpoint；所有选择都走普通用户消息。
- 旧 producer 可能产出 >12 options 的 interactive block：Hub 显示只读
  fallback，API 返回 422；生产端 skill 已改为 1–12。
- 并发**不同选择**的双提交（两次读都在 persist 前）会因不同确定性 messageId
  各自成功而产生两条消息；同选择双击是幂等重放/409。单 operator 且非破坏性，
  记录为 known limitation（砚砚 review 注）。

## 状态

- 实现、单测、API、fullstack、web 验证完成；待非作者 review、CI、合入与
  runtime 部署。

[宪宪/deepseek-flash🐾]
