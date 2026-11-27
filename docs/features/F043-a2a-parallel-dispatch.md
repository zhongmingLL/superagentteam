---
feature_ids: [superagentteam/F043]
related_features: [superagentteam/F037, superagentteam/F041]
title: "F043: A2A parallel dispatch & post_message surface"
status: in_progress
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: []
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-27
updated: 2026-11-27
source_decision: "operator 2026-11-27: a2a-测试 暴露 multi-mention 串行/串上下文、post_message 额外唤醒、气泡语义不清、单 agent 长跑阻塞其他 agent"
---

# F043: A2A parallel dispatch & post_message surface

## Why

operator 在 `a2a-测试` thread 做 multi-mention / post_message / 排队测试，暴露四个问题：

1. A/B/C 回答 multi-mention 后又各自 `post_message` 给 agent D；D 被额外唤醒多次，
   其中几条回复是"线程上下文为空"。
2. agent C 的回答声称"三家（A、B、我）均一致选 A"；按并行设计，C 不应看到 A/B 的回答。
3. `post_message` 在公开时间线里和普通 agent 回复长得一样，气泡语义不清楚。
4. agent D 持续运行两分钟期间，operator @agent C，C 被队列挡住，直到 D 结束才执行。

这些不是四个孤立 bug：Q2/Q4 共用同一个调度根因，Q1 是投递上下文根因，Q3 是消息表面设计问题。

## 用户结果

- multi-mention 的各目标从同一个触发快照开始，互相看不到本轮其他目标的回答。
- 单只 agent 的长任务不会阻塞其他 agent 的独立消息；队列面板只显示真正等待的投递。
- `post_message` 的目标能读到这条消息本身，不出现"无新消息"的空转回复。
- A2A 私有消息不再冒充公开回复：默认收成"投递回执行"或进入 multi-mention 汇总卡，
  需要时可展开正文。

## 根因（已定位，证据见报告）

- **Q2/Q4 调度**：`DaemonA2A.tick` 是 single-flight；`QueueProcessor.drain` 会 `await`
  `RunAgentTurn.dispatch` 的完整 turn。D 的两分钟 turn 占住 drain，C 的独立 entry 只能等。
  multi-mention 的多个 target 在 `processEntry` 里也是 `for ... await dispatch` 串行。
- **Q2 上下文**：`HistoryAssembler.loadHistory` 按每 agent 的 delivery cursor 取"之后"的消息；
  C 的 prompt 在 A/B 完成后才构建，A/B 的 response 对 C 可见（`visibleTo` 广播 response），
  所以 C 读到了 A/B 的结论。
- **Q1 空上下文**：`post_message` 会 enqueue `message_wake`；但 D 的 delivery cursor 已到 38，
  而 A/B/C 的 post_message 是 seq 19/23/25，低于 cursor，`loadHistory` 不会取到 →
  D 的 turn 看到空窗口，回复"无新消息"。
- **Q3 表面**：`post_message` 是 `lifecycle.kind=input` 的普通 agent 消息，前端按普通气泡渲染；
  没有收件人/A2A 语义，也没有和 multi-mention 汇总归组。

## 范围

- 调度：drain 在 provider handoff 后继续（不等完整 turn），或在 per-thread 内允许受控并发；
  multi-mention 的 target 并发 fan-out，tracker 继续按 (thread, agent) 保护同 agent 槽。
- 上下文：为每个 queue entry 固定触发消息快照（上界为触发 seq），并显式包含触发消息本身；
  不依赖目标 agent 的 delivery cursor 是否已越过它。
- `post_message`：把源消息作为目标的 exact input 投递；评估对 multi-mention 后续
  post_message 使用 no-wake/私有投递，避免重复唤醒。
- UI：A2A 私有消息的收敛设计（气泡/回执行/汇总卡），Pencil 稿见 `docs/design/F043/`。

## 非目标

- 不引入 task/run 脚手架，不改 thread-first 语义。
- 不改变 multi-mention 的聚合协议与 timeout/partial 语义。
- 不改 queue cap（v1 仍是每 thread 每 kind 5 条；Clowder 的用户消息 cap 也是 5）。

## 验收

- [ ] AC-1：multi-mention 三个 target 的 turn 实际并发启动；任一 target 的 prompt 不包含本轮
  其他 target 的 response（按触发 seq 快照）。
- [ ] AC-2：agent A 长跑期间 @agent B，B 在 A 结束前开始执行；队列面板只在 B 真正等待时显示。
- [ ] AC-3：post_message 唤醒的目标能在 prompt 中读到源消息；不再出现"无新消息"的空转回复。
- [ ] AC-4：A2A 私有消息按选定设计渲染，不再与公开回复混淆；multi-mention burst 不散落成多个气泡。
- [ ] AC-5：daemon/web tests、typecheck、doc-index 绿；非作者 review。

## 风险

- handoff 式 drain 改变失败收敛路径：provider-phase 失败必须仍能 terminalize/restore，
  不能留下悬空 turn/credential；需要针对失败路径补回归。
- 并发 fan-out 会放大 provider 并发；沿用 worker pool capacity，必要时做每 thread 上限。
- 上下文快照必须兼容现有 replay/ack 语义；不能让 response placeholder 被错误 ack。

## 进展（2026-11-27）

- 完成 live 取证与 Clowder 对照，根因报告：
  `docs/reports/2026-11-27-a2a-parallel-investigation.md`。
- 完成 A2A 消息表面 Pencil 设计稿：`docs/design/F043/a2a-message-1440.png`（三个候选方向）。
- 待 operator 选择设计方向并确认修复优先级后进入实现。
