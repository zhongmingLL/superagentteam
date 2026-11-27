---
feature_ids: [superagentteam/F045]
related_features: [superagentteam/F018, superagentteam/F043, superagentteam/F044, superagentteam/F048]
title: "F045: A2A delivery & multi-mention parity"
status: planned
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: []
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-27
updated: 2026-11-27
source_decision: "operator 2026-11-27: F043 的 post_message/auto-delivery 是补丁；按 0007 的 multi_mention group lifecycle 和源消息投递重做"
---

# F045: A2A delivery & multi-mention parity

> **先读（强制）**：
> - [`0007-a2a-runtime-chain.md`](../architecture/0007-a2a-runtime-chain.md)：target contract。
> - [`0019-a2a-runtime-chain-as-built.md`](../architecture/0019-a2a-runtime-chain-as-built.md)：当前 as-built，原 0008 as-built。
> - [`0050-a2a-runtime-alignment.md`](../plans/0050-a2a-runtime-alignment.md)：本计划。
>
> 本 feature 只实现计划切片；不得新增与 0007 冲突的投递/聚合设计。

## Why

F043 Q1 的“额外 post_message 唤醒 + 空上下文”是用 `multi_mention_auto_delivery`
拒绝和 per-turn source injection 补出来的。0007 的 `multi_mention` 是完整 group
lifecycle：request/source message/queue/parent/N children → aggregate system message →
callback child 给 `callbackTo`，并有 status/timeout/anti-cascade。target 的回答自动汇总，
不需要再发 `post_message`。

同时，`post_message` 的目标必须读到源消息本身；仅靠 delivery cursor 会在源 seq 低于
cursor 时得到空窗口。该语义必须进入 route/context 层（F044），而不是每个 turn 打补丁。

## 用户结果

- multi-mention 结束后 initiator 收到一次 aggregate + callback；不会因为 A/B/C 各自
  `post_message` 被多次唤醒。
- `post_message` 目标能在 prompt 中读到源消息，即使自己的 delivery cursor 已越过它。
- multi-mention target 向 initiator 的重复 `post_message` 被 typed 拒绝，不创建
  message/queue/wake。
- F043 AC-3 回归通过。

## 范围

- `post_message` 源消息投递：route/context 层保证 `includeSourceMessageId` 语义；
  cursor 已越过源 seq 时仍包含源消息。
- `MultiMentionOrchestrator` 按 0007 §3.8 核对/补齐：aggregate system message、
  `multi_mention_callbacks`、callback child、status read、timeout、anti-cascade。
- multi-mention prompt 明确“回答自动汇总，不需要 post_message”。
- 重复 target→initiator `post_message` 的 typed reject（`multi_mention_auto_delivery`），
  不创建消息/queue/parent。
- 回归 F043 Q1 场景与 AC-3。

## 非目标

- 不改 routeParallel/routeSerial 的核心调度（F044）。
- 不改 daemon 并发 drain（F046）。
- 不改前端汇总卡视觉（F047）。
- 不引入新的 model-facing tool；仍是四工具面。

## 验收

- [ ] AC-1：`post_message` 目标在 cursor 已越过源 seq 时仍能在 prompt 读到源消息；
  不出现“无新消息”空转。
- [ ] AC-2：multi-mention terminal 产生一次 aggregate system message + 一次 callback
  delivery 给 `callbackTo`；status read 反映 request/target/callback 状态。
- [ ] AC-3：target 向 initiator 的重复 `post_message` 返回
  `multi_mention_auto_delivery`，没有新增 message/queue/parent/wake。
- [ ] AC-4：multi-mention 的 target 不看到同批 sibling 回答（与 F044 barrier 联合）。
- [ ] AC-5：F043 AC-3 回归；daemon/web tests、typecheck、doc-index 绿；非作者 review。

## 证据

- 0007 §3.8 multi_mention lifecycle、callback、status、anti-cascade。
- 0019 §3.5/§7 R7/R8：as-built 的 F043 补丁与处置。
- `docs/reports/2026-11-27-a2a-parallel-investigation.md`：Q1 空上下文时间线。

## 风险 / 回滚

- multi_mention 状态机/callback 递归；按 depth ≤ 2、anti-cascade 与 timeout 覆盖。
- 不允许再以“target 自己 post_message”作为汇总路径。
- 回滚：revert feature 分支；不改 schema 的破坏性字段；callback 失败保留 typed 记录。

[宪宪/deepseek-flash🐾]
