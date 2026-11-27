---
feature_ids: [superagentteam/F046]
related_features: [superagentteam/F018, superagentteam/F031, superagentteam/F043, superagentteam/F044, superagentteam/F045, superagentteam/F050]
title: "F046: A2A tools & multi-mention parity"
status: planned
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: []
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-27
updated: 2026-11-27
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

**A9（auto-delivery 部分）、D1–D3、D6/F5**：

- A9：F043 的 `multi_mention_auto_delivery` 与 prompt 提示未进入 0007。
- D1：F031 rich block producer tool 未进入 0007 的 tool surface 记录。
- D2：`multi_mention_auto_delivery` 语义未进入 0007。
- D3：multi_mention prompt 模板未进入 0007。
- D6/F5：`MessageDispatchSummary` 文档声称 F018 拥有，代码没有；需要实现或明确 deferred。

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

## 非目标

- 不改 route/context barrier（F044/F045）。
- 不改 DDL/命名（F047）。
- 不改 daemon 并发（F048）。
- 不改前端汇总卡视觉（F049）。

## 验收

- [ ] AC-1（A9）：multi-mention terminal 产生一次 aggregate system message + 一次
  callback delivery 给 `callbackTo`；status read 反映 request/target/callback 状态。
- [ ] AC-2（A9）：target 向 initiator 的重复 `post_message` 返回
  `multi_mention_auto_delivery`，没有新增 message/queue/parent/wake。
- [ ] AC-3（D1）：0007 工具面记录 rich block producer tool；不改变四工具输入/输出。
- [ ] AC-4（D6/F5）：`MessageDispatchSummary` 有实现或明确 deferred 决策 + 证据。
- [ ] AC-5：F043 Q1 auto-delivery 回归；tests/typecheck/review 绿。

## 证据

- 0007 §3.8 tool surface、multi_mention lifecycle、callback/status/anti-cascade。
- 0019 §3.5/§7 R7/R8、audit A9/D1–D3/D6/F5。
- `docs/reports/2026-11-27-a2a-parallel-investigation.md`：Q1 时间线。
- F031 feature/plan：rich block producer tool。

## 风险 / 回滚

- multi_mention 状态机/callback 递归；按 depth ≤ 2、anti-cascade、timeout 覆盖。
- 不允许再以“target 自己 post_message”作为汇总路径。
- 回滚：revert feature 分支；callback 失败保留 typed 记录；不改 destructive schema。

[宪宪/deepseek-flash🐾]
