---
title: "F031 execution plan — rich block producer"
doc_kind: plan
status: in-progress
created: 2026-11-24
updated: 2026-11-24
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: [砚砚 (GLM 5.3 Flash), 墨墨 (Qwen 3.8 Flash)]
feature: F031
related_features: [superagentteam/F018, superagentteam/F028, superagentteam/F029]
related: [features/F031-rich-block-producer.md, features/F029-message-surface-parity.md, architecture/0017-response-draft-store.md, features/F018-thread-first-runtime.md]
source_decision: "operator 2026-11-24: F031 立项；producer tool + skill + draft/settlement/E2E"
---

# F031 execution plan

## Goal

让 agent 能在一次正常回复里创建富块，并沿 F018 的 durable draft/settlement 链路落到
最终 response message；Hub 复用 F029 的渲染层展示。F031 不新增前端组件，补的是
producer、存储、settlement 与 skill 四段。

## 契约冻结

### 工具

- 名称：`superagentteam_create_rich_block`
- 输入：

```ts
{
  block: {
    id: string;          // 1-64 chars, unique within one response
    kind: RichBlockKind; // card | diff | checklist | media_gallery | file | audio | html_widget | interactive
    v: 1;
    [field: string]: unknown;
  }
}
```

- 输出：`{ blockId: string; blockCount: number; maxBlocks: 20 }`
- typed errors：`rich_block_invalid` / `rich_block_too_large` / `rich_block_too_many` /
  `rich_block_approval_forbidden` / `rich_block_turn_not_running` /
  `tool_not_allowed`。
- 重复 id = replace；同一次 response 内最多 20 个；单 block 序列化后 ≤ 64 KiB。

### 存储

- `DraftRecord.richBlocks: RichBlock[]`；`response_drafts.rich_blocks_json` 默认 `[]`。
- `ResponseDraftStore.upsert()`（content/toolEvents/thinking 全量 flush）**不更新**
  `rich_blocks_json`；新增 `upsertRichBlock(turnExecutionId, block)` 独立写。
- `getByTurn()` 返回 `richBlocks`；T2/T4 读取它生成最终 `extra.rich`。
- 最终 response message 的 `extra.rich` 是唯一持久真相；draft 删除后不再保留第二份。

### 最终消息

- `RouteResponseCommitter.commit` 把 `draft.richBlocks` 传给
  `MessageStore.updateResponseContent`，后者更新 `extra_json` 的 `rich` 字段。
- 没有富块时保持 `extra` 原样（不写空 `{v:1,blocks:[]}`）。
- `ResponseRecoveryService` 的 T4 路径复用同一 commit，不单独实现恢复格式。

## 切片

### F031.1 契约 + migration 007

文件：

- `packages/superagentteam-shared/src/types/message.ts`：导出 `RichBlock`，复用
  `RichMessageExtra`。
- `packages/superagentteam-shared/src/types/invocation.ts`：`DraftRecord` 增加
  `richBlocks`。
- `packages/superagentteam-daemon/src/infrastructure/db/migrations/007-rich-blocks.ts`
  与 `migrations/index.ts`。
- `packages/superagentteam-daemon/src/domains/response/store.ts`：create/upsert/get
  与独立 rich-block 写路径。

RED：migration 测试断 old draft 默认 `[]`、JSON check 拒绝非数组；store 测试断
content flush 不覆盖 rich blocks。GREEN 后跑 daemon migration/store targeted。

### F031.2 Producer tool + control

文件：

- `packages/superagentteam-daemon/src/domains/rich-block/service.ts`：校验、上限、
  idempotent replace、调用 draft store。
- `packages/superagentteam-daemon/src/domains/a2a/control.ts`：新增
  `rich_block_create` 请求；复用 credential/turn/binding 校验。
- `packages/superagentteam-daemon/src/workers/a2a-extension.ts`：注册
  `superagentteam_create_rich_block`，复用现有 control client（不新开 socket）。
- `packages/superagentteam-daemon/src/domains/a2a/tool-service.ts` 与
  `domains/queue/processor.ts`：credential allowedTools 增加 `create_rich_block`。
- `packages/superagentteam-daemon/src/domains/message/store.ts`：`updateResponseContent`
  增加可选 `richBlocks`，合并 `extra.rich`。

RED：control 测试覆盖 credential 拒绝、turn 非 running、invalid kind、approval block、
21 个 block、重复 id；settlement 测试覆盖无富块与有富块两条路径。

### F031.3 Settlement + recovery

文件：

- `packages/superagentteam-daemon/src/domains/invocation/settlement.ts`：T2 commit
  读取 `draft.richBlocks`；T4 复用。
- `packages/superagentteam-daemon/src/domains/message/store.ts`：最终 `extra_json` 更新。
- `docs/architecture/0017-response-draft-store.md`：补 rich blocks 与 T2 生成规则。

RED：T2 后 response message 的 `extra.rich.blocks` 与 draft 一致；T4 崩溃恢复后一致；
无富块时 `extra` 不出现空 rich。

### F031.4 Skill + prompt

文件：

- `packages/superagentteam-skills/skills/superagentteam-rich-messaging/SKILL.md`。
- `packages/superagentteam-skills/manifest.yaml`。
- `packages/superagentteam-daemon/src/domains/worker/pi-spawn.ts`：只把
  `superagentteam-rich-messaging` 作为显式 `--skill` 传给 v1 worker；保留
  `--no-skills` 关闭目录发现。
- `packages/superagentteam-daemon/src/workers/a2a-extension.ts`：
  `promptGuidelines` 指向“少而有用、interactive 只读、不要伪造 approval”。

RED：skills catalog 测试断 manifest 可解析、路径存在、无 secret；worker args 测试断
只注入这一份 skill。

### F031.5 E2E + evidence

- 隔离 daemon + 真实 provider：让 agent 创建 card + checklist；断言 Hub history 的
  response message `extra.rich.blocks` 有两个块，刷新后仍在。
- 1440/390 光暗截图存 `docs/design/F031/`。
- `NODE_ENV=development npm test --workspace @superagentteam/daemon`、
  `npm run check:web`、`npm run build:offline`、`npm run check:doc-index`。
- PR 说明五轴风险；contract/security 由砚砚 review，vision/UX 由墨墨 review。

## 测试矩阵

| 层 | 用例 |
|---|---|
| shared | RichBlock 类型、DraftRecord 默认值、非法 block 形状 |
| migration | up/down、旧行默认 `[]`、JSON array check |
| response store | create/upsert、content flush 不覆盖 rich、重复 id replace、上限 |
| control | credential allowlist、worker binding、turn 状态、typed errors |
| settlement | T2 写入 `extra.rich`、无富块不写、T4 recovery 一致 |
| skills | manifest、skill 文件、worker 只注入 rich-messaging |
| web | F029 渲染回归、未知 kind fallback、1440/390 截图 |
| E2E | 真实 provider 回合创建 card+checklist、刷新后仍在 |

## 回滚

- migration 007 down 删除 `rich_blocks_json`；旧 draft 不依赖该列。
- 工具与 control 请求是新增面；回滚可移除注册与 allowlist 项，A2A 四工具不受影响。
- 最终消息只在 `extra.rich` 增加展示字段；移除后正文仍可读。
- 不做数据迁移；已产生的 `extra.rich` 保持向后兼容，F029 渲染器可继续消费。

## 门禁

- Design Gate：F029 已完成渲染层 vision 验收；F031 只新增消息内富块，不改变 Hub
  布局。operator 2026-11-24 “F031立项” 作为本 feature 的范围确认；实现前不再重复
  索要方向确认。
- Review：作者不能自审；砚砚覆盖 credential/control/migration/settlement，墨墨覆盖
  skill/消息呈现与真实 E2E 截图。
- Merge：CI 全绿 + 双审 approve + 真实 E2E 证据；未合入前不对外声明 rich blocks 可用。

## 进展

- 2026-11-24：F031.1–F031.5 实现完成，进入 review。
- migration 007 / response store / settlement / control / extension / skill / spawn
  注入均已落地；daemon 912 tests、web 99 tests、skills 15 tests、根级 check 全绿。
- 真实 Hub E2E：thread `thread:a0e22bbd7058fd21473d44eb9c7393e1`，agentA 创建
  `hub-card` + `hub-checklist`，最终消息 `extra.rich` 两个 block；1440/390 光暗截图见
  `docs/design/F031/`。
- 待办：PR review（砚砚 credential/control/migration/settlement；墨墨 skill/呈现/E2E）。

[宪宪/deepseek-flash🐾]
