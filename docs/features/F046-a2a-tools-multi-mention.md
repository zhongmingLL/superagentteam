---
feature_ids: [superagentteam/F046]
related_features: [superagentteam/F018, superagentteam/F031, superagentteam/F043, superagentteam/F044, superagentteam/F045, superagentteam/F050]
title: "F046: A2A tools & multi-mention parity"
status: implemented
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: [砚砚 (GLM 5.3 Flash)]
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-27
updated: 2026-11-28
source_decision: "operator 2026-11-27: 纠正所有 0007↔当前实现偏移；tool surface/multi_mention 按 0007 §3.8 对齐，F043 行为作为回归"
---

# F046: A2A tools & multi-mention parity

> **先读（强制）**：
> - [`0007-a2a-runtime-chain.md`](../architecture/0007-a2a-runtime-chain.md)：target contract。
> - [`0019-a2a-runtime-chain-as-built.md`](../architecture/0019-a2a-runtime-chain-as-built.md)：当前 as-built，原 0008 as-built。
> - [`2026-11-27-0007-as-built-audit.md`](../reports/2026-11-27-0007-as-built-audit.md)：A–F 偏移证据。
> - [`0050-a2a-runtime-alignment.md`](../plans/0050-a2a-runtime-alignment.md)：本计划。
>
> 本 feature 只实现计划切片；不得新增未记录的第五个 A2A tool。

## 覆盖的 audit 偏移

**A9（auto-delivery 部分）、D1–D3、D6/F5、F8**：

- A9：F043 的 `multi_mention_auto_delivery` 与 prompt 提示未进入 0007。
- D1：F031 rich block producer tool 未进入 0007 的 tool surface 记录。
- D2：`multi_mention_auto_delivery` 语义未进入 0007。
- D3：multi_mention prompt 模板未进入 0007。
- D6/F5：`MessageDispatchSummary` 文档声称 F018 拥有，代码没有；需要实现或明确 deferred。
- F8：`MultiMentionStatusReader` → `MultiMentionStore.statusView` 的命名/接口映射。

## Why

0007 §3.8 定义四工具面 + multi_mention group lifecycle：
`post_message`/`cross_post_message`/`multi_mention`/`thread_context`；
multi_mention 有 aggregate system message、callback child、status/timeout/anti-cascade。
F031 另在同一个 control socket 上暴露 `superagentteam_create_rich_block`，0007 没记录；
F043 又加了 auto-delivery 拒绝和 prompt 提示。F046 把这些工具面/行为统一回 0007，
而不是让它们散落在 F043 补丁里。

## 用户结果

- multi-mention 结束后 initiator 收到一次 aggregate + callback；不会因为 A/B/C 各自
  `post_message` 被多次唤醒。
- target 向 initiator 的重复 `post_message` 被 typed 拒绝，不创建 message/queue/wake。
- rich block producer tool 与四工具面的关系在 0007/0019 有明确记录。
- `MessageDispatchSummary` 的实现/延迟决策明确，不再“文档说有、代码没有”。

## 范围

- 按 0007 §3.8 核对/补齐 `MultiMentionOrchestrator`：aggregate system message、
  `multi_mention_callbacks`、callback child、status read、timeout、anti-cascade。
- multi-mention prompt 明确“回答自动汇总，不需要 post_message”。
- 重复 target→initiator `post_message` 的 typed reject（`multi_mention_auto_delivery`），
  不创建消息/queue/parent。
- 0007 工具面补记 `superagentteam_create_rich_block`（F031）与四工具的关系。
- `MessageDispatchSummary`：实现或明确写为 deferred（0019/F016c S0 证据）。
- `MultiMentionStatusReader`/`statusView`：验证 status read 语义，记录映射或抽 reader。

## 非目标

- 不改 route/context barrier（F044/F045）。
- 不改 DDL/命名（F047）。
- 不改 daemon 并发（F048）。
- 不改前端汇总卡视觉（F049）。

## 验收

- [x] AC-1（A9）：multi-mention terminal 产生一次 aggregate system message + 一次
  callback delivery 给 `callbackTo`；status read 反映 request/target/callback 状态。
- [x] AC-2（A9）：target 向 initiator 的重复 `post_message` 返回
  `multi_mention_auto_delivery`，没有新增 message/queue/parent/wake。
- [x] AC-3（D1）：0007 工具面记录 rich block producer tool；不改变四工具输入/输出。
- [x] AC-4（D6/F5）：`MessageDispatchSummary` 有实现或明确 deferred 决策 + 证据。
- [x] AC-5：F043 Q1 auto-delivery 回归；tests/typecheck/review 绿。
- [x] AC-6（A6 / F044 AC-3）：A2A successor 只在 response durable commit 后 admission；
  F046b 已把 post/cross 的 queue admission 移入 T2/T4，tool 时只写 pending successor。

- [x] AC-E2E（operator 2026-11-27，强制，F046a）：必须在**当前测试 worktree**的隔离 test runtime
  跑真实端到端链路；**Clowder 是 golden**，先按其 multi-mention/tool 参考实现/测试
  构建用例与断言，再在本仓复现；执行时观察并输出 daemon/worker/queue 日志关键行；
  unit/targeted test 只能补充，不能替代。证据须含 worktree/HEAD、隔离端口/data dir、
  用例、日志/输出、结果；无 E2E 证据不得声明 verified。
  方式基线：[`0021-e2e-acceptance-standard.md`](../architecture/0021-e2e-acceptance-standard.md)
  （F044 方法）；R5 multi_mention + callback 必须有真实 provider 成功路径。

## 证据

### 执行（2026-11-28，F046a）

- **B 层 R5**：`f044-route-fullstack-e2e.test.ts` F046 用例（真实 daemon + 真实 pi
  worker + mock provider）：A 调 `multi_mention` → B/C 回复、B 的重复 `post_message`
  被 `multi_mention_auto_delivery` 拒绝（无 message/queue/parent）→ 一条 aggregate
  system message + 一次 callback → A 的 callback turn 完成。断言 request done、
  responses 2 received、statusView、aggregate 唯一、两个 parent completed、queue 空。
- **P 层真实 provider**：`f046-multi-mention-live.e2e.test.ts`（hybrid：A mock 确定性
  触发工具，B/C 真实 Kimi）：B/C 都回复 “4”；aggregate + callback 完成；5.2s。
  命令（key 只从 0600 env 注入，不打印）：
  `SUPERAGENTTEAM_LIVE_PROVIDER=1 SUPERAGENTTEAM_LIVE_PROVIDER_ID=kimi-coding SUPERAGENTTEAM_LIVE_API_KEY_REF=KIMI_API_KEY SUPERAGENTTEAM_LIVE_MODEL=kimi-for-coding npx vitest --run test/f046-multi-mention-live.e2e.test.ts`
  → 1 passed。默认 skip，不进 CI。
- **文档**：0007 §3.8 补 rich block producer tool、prompt template、auto-delivery；
  §3.10.5 明确 `MessageDispatchSummary` deferred（F016c S0/0019 R8）；0019 R9 补
  F8 `statusView` 映射与 callback `queueEntryId` ON DELETE SET NULL 语义。
### F046b successor admission（2026-11-28）

- `post_message`/`cross_post_message` targets 非空时，tool handler 只写 message +
  caller credential 的 `pendingSuccessor`；`queueEntryId=null`，不建 queue/parent。
- `RouteResponseCommitter` 在 T2 事务内 flush pending successor（enqueue + claim
  回写 `queueEntryId`）；T4 已 terminal R 的 settling tail 执行同一 flush；T2 失败
  时 R 保持 processing，由 T4 重试。
- fullstack F046b：A 的 tool message 已落库、A 仍 running 时，B 的 queue entry
  不存在；B provider 请求到达时 A 的 R 已 completed；claim `queueEntryId` 回写、
  `pendingSuccessor` 清空。
- 旧的 tool-time queue 断言已改为 pending 契约；cross_post R4/fullstack 继续通过，
  证明 flush 后链路不变。

### 2026-11-28 验收调整（operator）

- multi-mention target 回复保留在主时间线（不再用 aggregate responseMessageId 过滤），
  汇总卡作为摘要；避免“运行中可见、完成后消失”。
- 汇总卡与 agent 气泡同列（38px 偏移 + 80% 列宽）；`post_message` 气泡同列，并在 body
  内加 `post_message` 标签 + 横线，保留原 sender/recipient 头部与 footer。
- PR #266 merged `7fe438118`；墨墨 approve；报告
  [`2026-11-28-f037-acceptance-a2a-bubbles.md`](../reports/2026-11-28-f037-acceptance-a2a-bubbles.md)。
- cross_post 投递消息独立呈现（无头像、来源收进 sender 圆框、气泡内
  `cross_post_message` + 发送目标 + 横线）；PR #268 merged `dceb0f86e`；
  报道 [`2026-11-28-f037-cross-post-bubble.md`](../reports/2026-11-28-f037-cross-post-bubble.md)。

- **Clowder 参考路径**（相对参考仓根目录）：
  - `packages/mcp-server/src/tools/callback-tools.ts`（post/cross_post/multi_mention tool schemas/handlers）
  - `packages/api/src/routes/callbacks.ts`（post_message callback delivery）
  - `packages/api/src/routes/callback-multi-mention-routes.ts`
  - `.../routing/MultiMentionOrchestrator.ts`
  - `.../routing/multi-mention-state-machine.ts`
  - `.../routing/callback-post-result.ts`
- 0007 §3.8 tool surface、multi_mention lifecycle、callback/status/anti-cascade。
- 0019 §3.5/§7 R7/R8、audit A9/D1–D3/D6/F5。
- `docs/reports/2026-11-27-a2a-parallel-investigation.md`：Q1 时间线。
- F031 feature/plan：rich block producer tool。

## 风险 / 回滚

- multi_mention 状态机/callback 递归；按 depth ≤ 2、anti-cascade、timeout 覆盖。
- 不允许再以“target 自己 post_message”作为汇总路径。
- 回滚：revert feature 分支；callback 失败保留 typed 记录；不改 destructive schema。

[宪宪/deepseek-flash🐾]
