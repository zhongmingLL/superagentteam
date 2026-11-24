---
feature_ids: [superagentteam/F031]
related_features: [superagentteam/F018, superagentteam/F028, superagentteam/F029, superagentteam/F030]
title: "F031: Rich block producer — agent-created rich blocks in responses"
status: spec
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: [砚砚 (GLM 5.3 Flash), 墨墨 (Qwen 3.8 Flash)]
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-24
updated: 2026-11-24
source_decision: "operator 2026-11-24: F031 立项；F029 展示层之后补生产端（producer tool + skill + draft/settlement/E2E）"
architecture_cell: "bubble-pipeline + hub-action-surface"
map_delta: "update required"
---

# F031: Rich block producer

## Why

F029 已经让 Hub 能渲染 `message.extra.rich`，但只有展示层：agent 没有任何工具可以把
rich block 写进自己的回复，`response_drafts` 也不保存富块。结果是 operator 在 Hub 里
永远看不到 agent 生成的 card / checklist / diff / media 等结构化内容，F029 的渲染能力
只能靠手工构造消息验证。

Clowder 的参考链路是 **skill 负责判断、tool 负责写入、draft 负责暂存、settlement 负责
落最终消息**。F031 补的就是这条生产链路，而不是再写一套前端组件。

## 现状基线

- `packages/superagentteam-shared/src/types/message.ts` 已有 `RichBlockKind` 与
  `RichMessageExtra`；消息 `extra.rich` 是 Hub 的展示容器。
- F029 的 `RichBlocks.tsx` 已能渲染 card / diff / checklist / media_gallery / file /
  audio / html_widget / interactive（interactive 只读），未知 kind 有 fallback。
- `messages` 表已有 `rich_blocks_json`；API `POST /api/messages` 接受用户消息的
  `extra.rich` 并做基础形状校验。
- F018 v1 worker 只注册四个 A2A 工具；`response_drafts` 只有 `content` /
  `tool_events_json` / `thinking`，没有富块字段；`0017-response-draft-store.md`
  明确写“最终 rich 在 T2 生成”，但当前 T2 并不生成。
- v1 worker 启动参数是 `--no-skills`；`packages/superagentteam-skills` 已有 curated
  skill 目录和 allowlist，但还没有 rich-messaging 条目。

## 用户结果

- agent 在一次正常回复里创建 1–20 个富块；Hub 在**该 agent 的回复消息**下渲染它们，
  刷新/重连后仍在。
- 文本正文和富块可以同时存在：正文承载解释，富块承载可扫读的结构。
- 非法富块不会污染回复：未知 kind、超限、approval block、缺少必需字段都返回 typed
  error，正文仍按原路径提交。
- 同一 block id 的重复创建是幂等的；agent 重试不会产生重复卡片。
- worker 拿到一份明确的 `rich-messaging` skill 指导，知道何时该用哪种 block，而不是
  靠猜 schema。

## User Journey

- **Scope unit:** 单条 agent response message。
- **Primary journey:** operator 在 Hub 里让 agent 做一次带结构化结果的回复（例如
  “把这次改动整理成 review card”）→ agent 调用
  `superagentteam_create_rich_block` → Hub 回复下方出现对应富块 → operator 刷新 Thread
  仍能看到同一组富块。
- **Failure journey:** agent 传入未知 kind 或超过 20 个 block → 工具返回 typed error，
  agent 可以改用文本或修正后重试；Hub 不出现半个损坏的富块。
- **Recovery journey:** daemon 在 T1 后、T2 前崩溃 → T4 从 durable draft 恢复时把富块
  一起提交到最终回复，不丢失也不重复。

## 范围

### F031.1 契约与存储

- 在 shared 层导出可复用的 `RichBlock` 类型；`DraftRecord` 增加
  `richBlocks: RichBlock[]`。
- `response_drafts` 新增 migration 007：`rich_blocks_json TEXT NOT NULL DEFAULT '[]'`
  （JSON array check）；down 走 SQLite 表重建或等价安全回滚。
- `ResponseDraftStore` 增加独立的富块写路径（`upsertRichBlock` / `list`），
  **content flush 的 `upsert` 不覆盖 `rich_blocks_json`**，避免 ResponseEventSink 与
  rich-block 工具互相踩写。
- 统一校验：最多 20 个 block；单 block JSON 上限 64 KiB；id 1–64 字符且响应内唯一；
  kind 必须在 8 种内；approval block 继续拒绝。

### F031.2 Producer tool + control 通道

- 注册模型面工具 `superagentteam_create_rich_block`，参数为
  `{ block: { id, kind, v: 1, ...kind-specific fields } }`。
- 工具走现有 v1 worker control socket，新增 `rich_block_create` 请求；daemon 重新校验
  credential、worker binding、running TurnExecution 与 allowlist，不能只信 worker。
- `create_rich_block` 加入 InvocationCredential 的 allowedTools；A2A 四工具不变。
- 重复 id 采用 replace 语义（幂等重试）；超过 20 个或超限返回 typed error，不静默丢弃。
- 工具返回 `{ blockId, blockCount, maxBlocks }`，不返回整段消息。

### F031.3 Settlement 落最终消息

- T2 `RouteResponseCommitter` 从 draft 读取 `richBlocks`，写入 response message 的
  `extra.rich = { v: 1, blocks }`；没有富块时不写空 `extra.rich`。
- T4 `ResponseRecoveryService` 走同一路径，保证崩溃恢复不丢富块。
- 最终 R 的 `extra.rich` 是唯一持久真相；draft 在 T2/T4 后照常删除。
- 更新 `0017-response-draft-store.md`：draft 增加 rich blocks，T2 负责生成最终
  `extra.rich`。

### F031.4 Skill 与 prompt 引导

- 新增 `packages/superagentteam-skills/skills/superagentteam-rich-messaging/SKILL.md`，
  说明 8 种 block 的适用场景、最小字段、何时不该用、interactive v1 只读。
- 在 `manifest.yaml` 注册；v1 worker 启动时只显式注入这一份 skill（保留
  `--no-skills` 关闭目录发现），不把所有 curated skill 塞进 worker。
- 工具 `promptGuidelines` 与 skill 说同一套限制，避免两套口径。

### F031.5 E2E 与证据

- store/migration 单测：默认空数组、独立写不覆盖 content、重复 id、超限、非法
  approval block、down migration。
- control/tool 单测：credential allowlist、turn 非 running、invalid kind、幂等重试。
- settlement 单测：T2 写入 `extra.rich`、无富块不写、T4 recovery 保留富块。
- 真实 provider E2E：agent 在真实回合里创建一个 card + 一个 checklist，Hub 消息显示
  两个 block；刷新后仍在。
- 1440/390 光暗截图存 `docs/design/F031/`；web typecheck/tests/build 与
  `check:doc-index` 通过。

### 非目标

- interactive 的真实点击 / callback action（F029 仍只读；另立后续 feature）。
- 文件上传、TTS 生成、媒体转码、富块跨 thread 转发。
- 富块在 settlement 前的 live 预览；F028 的 tool call 记录足以显示“正在创建”。
- 第二个 `get_rich_block_rules` 工具；v1 由工具 description + skill 承载 schema。
- 用户消息富块生产端；本 feature 只解决 agent response。

## 验收标准

- [ ] AC-1：`superagentteam_create_rich_block` 出现在 v1 worker 工具面，credential
      allowlist 包含 `create_rich_block`。
- [ ] AC-2：真实回合中 agent 创建的 card / checklist 出现在最终 agent 回复的
      `extra.rich.blocks`，Hub 刷新后仍渲染。
- [ ] AC-3：同一 block id 重试不重复；超过 20 个、超过 64 KiB、未知 kind、approval
      block 均 typed reject，正文不受影响。
- [ ] AC-4：T4 recovery 从 draft 恢复富块，不丢失、不重复。
- [ ] AC-5：`superagentteam-rich-messaging` skill 已注册且只注入 v1 worker；worker
      能说明何时用哪种 block。
- [ ] AC-6：migration up/down、store、control、settlement、web 渲染测试全绿；
      真实 E2E 与 1440/390 截图有记录。

## 依赖与风险

- 依赖 F018 的 response draft/settlement/control 链路与 F029 的渲染层。
- **并发写风险**：content flush 与 rich-block 工具都可能写同一 draft；用独立列 +
  独立方法规避，不能把 `richBlocks` 放回全量 `upsert`。
- **安全风险**：html_widget 已有 sandbox iframe；仍需限制单 block 大小、拒绝 approval
  block，不让 agent 伪造审批卡。
- **迁移风险**：migration 007 必须可 down；旧 draft 默认 `[]`，不影响现有回合。
- **体验风险**：富块过多会淹没正文；v1 用 20 个上限 + skill 引导“只放真正帮助扫读的
  1–3 个”。

## 开放问题

- 每种 kind 的字段校验做到多严：v1 先校验顶层 + 最小必需字段，避免过度约束模型；
  若出现坏块污染，再按 kind 收紧。
- settlement 前是否要在 SSE 发 `rich_block` 事件：v1 不做，terminal 后由 HTTP
  history 统一渲染；后续若需要实时出现再单独评估。

[宪宪/deepseek-flash🐾]
