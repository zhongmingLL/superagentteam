---
feature_ids: [superagentteam/F048]
related_features: [superagentteam/F018, superagentteam/F043, superagentteam/F044, superagentteam/F045, superagentteam/F050]
title: "F048: A2A queue/concurrency/recovery parity"
status: planned
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: []
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-27
updated: 2026-11-27
source_decision: "operator 2026-11-27: 纠正所有 0007↔当前实现偏移；queue/tracker/recovery 按 0007 对齐，长 turn 不阻塞独立 entry"
---

# F048: A2A queue/concurrency/recovery parity

> **先读（强制）**：
> - [`0007-a2a-runtime-chain.md`](../architecture/0007-a2a-runtime-chain.md)：target contract。
> - [`0019-a2a-runtime-chain-as-built.md`](../architecture/0019-a2a-runtime-chain-as-built.md)：当前 as-built，原 0008 as-built。
> - [`2026-11-27-0007-as-built-audit.md`](../reports/2026-11-27-0007-as-built-audit.md)：A–F 偏移证据。
> - [`0050-a2a-runtime-alignment.md`](../plans/0050-a2a-runtime-alignment.md)：本计划。
>
> 本 feature 只实现计划切片；并发上界与 per-agent slot 不得为“跑得快”而放宽。

## 覆盖的 audit 偏移

**B2（methods）、B4/B5、A8（concurrency）、E2、E3（concurrency）**：

- B2：QueueProcessor 方法面缺 `requestDrain`/`processNext`/`recoverStartup`/
  `onInvocationComplete` 等。
- B4：InvocationTracker API/返回值与 0007 不一致。
- B5：tracker 抢占不写旧 TurnExecution terminal。
- A8：routeAgents per-child signal / serial acceptance 的并发部分。
- E2：§9.1 preflight invalid reasons 缺 `session_workspace_changed` /
  `workspace_unavailable`；0019 §8 D4 已修代码，本 feature 补验收/回归。
- E3：routeAgents 验收的并发部分。

## Why

F043 Q4 的“D 长跑阻塞 C”根因是 `DaemonA2A.tick` 全局 single-flight + `drain`
await 完整 turn。0007 的 route/queue 设计本来就允许不同 target 的 entry 由后续 drain
并行，同时用 per-(thread, agent) tracker slot 保证同 agent 顺序。F048 把 queue/tracker/
recovery 的 API 和并发语义正式对齐，并补 backpressure/read model。

## 用户结果

- 一只 agent 长跑时，其他 agent 的独立消息仍能启动，不被长 turn 挡住。
- 同一 agent 的后续消息仍按顺序等待，不会双启。
- queue/live 面板只显示真正等待的投递；运行中的长 turn 不被误报为排队。
- tracker 抢占/恢复的 TurnExecution terminal owner 明确，不留僵尸。
- preflight 的 workspace/session 永久失效按 invalid target 终态化，不无限 defer。

## 范围

- `QueueProcessor` 方法面按 0007 恢复：`requestDrain`/`processNext`/`recoverStartup`/
  `onInvocationComplete`；保留现有 `requestRetry`/`abandon` 的等价能力。
- `InvocationTracker` API/返回值对齐；`cancel` reason；`listStaleSlots` 语义。
- tracker 抢占：旧 TurnExecution 的 terminal owner 明确（tracker 或 turn abort 收敛），
  补测试。
- `DaemonA2A.tick`/drain：有界并发，而不是全局 single-flight；per-agent slot 保序。
- capacity/backpressure；queue/live 读模型等待 vs running 准确。
- preflight invalid reasons 的验收/回归：`session_workspace_changed` /
  `workspace_unavailable`（0019 §8 D4 代码已修）。
- P3-a（#240 review）：`invalidSessionReason` 以 error.message 精确匹配；
  `ensureActive` 其余 3 个 reject 当前不可达但脆弱。后续改 typed session error 或在
  preflight 显式分类；不在本 feature 静默忽略。
- P3-c（#240 review）：`processEntry` catch 的 `permanent:` defer 只 releaseClaim +
  defer，不调用 `RetryDeferrals`；未来任何逃逸错误会每 tick 空转。给 permanent defer
  登记 bounded backoff，或证明所有 permanent 错误都已 typed invalid。
- 回归 F043 AC-2。

## 非目标

- 不改 routeParallel/routeSerial ownership（F044）。
- 不改 history/source message（F045）。
- 不改 multi-mention/工具面（F046）。
- 不改 DDL/命名（F047）。

## 验收

- [ ] AC-1（A8/E3）：agent A 长 turn 运行中，operator @agent B 的独立 entry 在 A 结束前启动并完成；per-child signal 正确。
- [ ] AC-2（B2/B4）：QueueProcessor/Tracker 方法面与 0007 对齐或明确映射；tracker
  cancel/listStaleSlots 语义有测试。
- [ ] AC-3（B5）：tracker 抢占/恢复的 TurnExecution terminal 有唯一 owner；无僵尸。
- [ ] AC-4：同一 agent 的后续 entry 仍按序等待；不同 agent 可并行；queue/live 只显示真实等待。
- [ ] AC-5：并发有上界/backpressure；F043 AC-2 回归；tests/typecheck/review 绿。
- [ ] AC-6（E2/P3-a）：`session_workspace_changed` / `workspace_unavailable` 走 invalid
  target 终态化 + typed delivery_failure；无限 defer 回归不存在；其余 session reject
  的脆弱匹配有记录/后续方向。

- [ ] AC-E2E（operator 2026-11-27，强制）：必须在**当前测试 worktree**的隔离 test runtime
  跑真实端到端链路；**Clowder 是 golden**，先按其 queue/tracker/recovery 参考实现与
  测试构建用例和断言，再在本仓复现；执行时观察并输出 daemon/worker/queue 日志关键行；
  unit/targeted test 只能补充，不能替代。证据须含 worktree/HEAD、隔离端口/data dir、
  用例、日志/输出、结果；无 E2E 证据不得声明 verified。

## 证据

- **Clowder 参考路径**（相对参考仓根目录）：
  - `.../invocation/QueueProcessor.ts`（requestDrain/processNext/drain/processEntry）
  - `.../invocation/InvocationQueue.ts`（claim/retire/release）
  - `.../invocation/InvocationTracker.ts`
  - `.../invocation/InvocationOwnerReaper.ts` + `InvocationOwnerReaperInterval.ts`
  - `.../invocation/StartupReconciler.ts` + `TurnExecutionStartupReconciler.ts`
  - `.../invocation/queue-retry-deferrals.ts` / `queue-routing-recovery-policy.ts`
  - `packages/api/src/index.ts`（QueueProcessor composition root）
- 0007 §3.2 candidate selection、§3.4 tracker、§3.9 recovery、§9.1 concurrency。
- 0019 §6 端到端 as-built、§8 D4、F043 live 时间线（D 60s turn / C probe 169ms）。
- `docs/reports/2026-11-27-a2a-parallel-investigation.md`：Q4 根因。
- D4 回归：`packages/superagentteam-daemon/test/f018-r2a-dispatch.test.ts`。

## 风险 / 回滚

- 并发 bug/claim 竞争；用 per-agent slot + 并发上界 + 压力测试覆盖。
- 不允许用全局 single-flight 换简单；那会回退 F043 Q4。
- 回滚：revert feature 分支；live 切换需 operator 授权。

[宪宪/deepseek-flash🐾]
