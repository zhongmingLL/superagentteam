---
feature_ids: [superagentteam/F053]
related_features: [superagentteam/F043, superagentteam/F046, superagentteam/F048, superagentteam/F052]
title: "F053: Queue steer — 引导当前回复 / 中断并立即发送"
status: implemented
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: []
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-28
updated: 2026-11-28
source_decision: "operator 2026-11-28: 实现 steer，先参考 Clowder 的 steer 设计"
---

# F053: Queue steer — 引导当前回复 / 中断并立即发送

## Why

Clowder 的 Queue Steer（F047）让 operator 在消息排队等待时，不必撤回或重发：
对同一条持久消息逐成员选择「接进当前回复」或「停下并处理这条」。SuperAgentTeam
目前只有只读的 `QueueStrip`（位置/目标/状态/等待时间），排队消息只能等 drain；
运行中的 agent 也无法接收 operator 的即时纠偏。

SAT 的 pi worker 已原生支持 `steer` RPC（`coding-agent` rpc-mode），daemon 的
`RpcConnection` 尚未暴露；queue ledger 已支持按 target claim/retire。F053 把这条
能力接到真实运行链上。

## 用户结果

- 队列中的消息行显示「处理这条」；`processing/claimed` 行不显示。
- 弹窗按目标列出成员；每个目标可选「接进当前回复」或「停下并处理这条」。
- 「接进当前回复」不取消当前轮，只把消息注入正在运行的同一 agent turn；
  目标从 Queue 中 retire，并写入 input `dispatchRefs`。
- 「停下并处理这条」取消该目标当前轮（若有），以同一条 Queue row 立即启动；
  sibling 目标保持 pending，不被整批取消。
- 没有活动轮次时「接进当前回复」禁用；「停下并处理这条」直接在空闲 agent 上启动。
- 失败有 typed 错误（entry 已处理、target 已投递、轮次已结束、RPC 失败），
  UI 刷新到最新队列，不伪造成功。

## 范围

### 后端

- `SteerRegistry`：`(threadId, agentId) → { turnExecutionId, attempt, steer(content) }`，
  由 `RunAgentTurn` 在 worker prompt 期间注册/注销。
- daemon `RpcConnection.steer()`：调用 pi worker 的 `steer` RPC，返回
  `handled | queued` disposition。
- `SteerService`：
  - 校验 thread owner、entry `queued`、target 仍 pending；
  - 短 claim（target-scoped）→ guide / interrupt → retire target；
  - guide：校验 tracker 的 exact `turnExecutionId` 与 registry 一致，写
    input `dispatchRefs`（`phase:"dispatched"`）；
  - interrupt：`tracker.cancel`（若有）→ 设 entry `urgent` → `QueueProcessor.processEntry`。
- `POST /api/threads/:threadId/queue/:entryId/steer`
  body：`{ targetAgentId, mode: "guide" | "interrupt" }`。

### Web

- `QueueStrip` queued 行增加「处理这条」；claimed 行不显示。
- `SteerQueueDialog`：目标 chips + 逐目标策略（guide 在无活动轮次时禁用）+
  确认；多目标按顺序逐 target 提交，失败项如实反馈。
- `a2aApi.steerQueue` / `useA2AStore.steerQueue`；成功后刷新 queue + live。

## 非目标

- 不做 Clowder 的 atomic multi-target reconcile / membership-at-open fence。
- 不做 reorder / promote / supplement / append-to-existing-run 扩展。
- 不新增第二套 Queue 或 per-target 行；仍使用 `invocation_queue` + `targets[]`。
- 不改 A2A 工具契约、消息内容或 provider prompt 结构。

## 验收标准

- [x] AC-1：queued entry 可 guide；不取消 active turn；目标 retire；input message
      写入 dispatchRef，`turnExecutionId` 指向 active turn。
- [x] AC-2：queued entry 可 interrupt；active turn 取消；同一 entry/target 立即启动；
      sibling target 保持 pending。
- [x] AC-3：无 active turn 时 guide 返回 typed 409；interrupt 在空闲 agent 上直接启动。
- [x] AC-4：非 owner、claimed entry、target 已投递、RPC steer 失败均有 typed 错误；
      claim 不泄漏。
- [x] AC-5：web 只在 queued 行显示「处理这条」；guide 在无活动轮次时禁用；
      多目标顺序提交与失败反馈可用。
- [x] AC-6：daemon 定向 + fullstack E2E（真实 pi worker + mock provider）证明
      guide 注入与 interrupt 重启；web tests + typecheck/build 绿。

## 实现

- `domains/queue/steer/registry.ts`：process-local live-turn binding。
- `pi-worker/rpc-client.ts` + `WorkerRpcConnection.steer`：pi worker `steer` RPC。
- `domains/execution/turn.ts`：prompt 窗口 attach/detach registry。
- `domains/queue/steer/service.ts`：target claim → guide / interrupt → retire；
  interrupt 走 `tracker.cancel` + urgent + `QueueProcessor.processEntry`。
- `QueueLedgerStore.setPriority`：只改 queued/claimed 的 priority。
- `POST /api/threads/:threadId/queue/:entryId/steer`：
  `{ targetAgentId, mode: "guide" | "interrupt" }`，CSRF + owner + typed errors。
- Web：`QueueStrip` queued 行「处理这条」；`SteerQueueDialog` 目标复选 + 逐目标
  guide/interrupt + 顺序提交；`a2aApi.steerQueue` / store refresh。

## 证据

- 报告：[`2026-11-28-f053-queue-steer.md`](../reports/2026-11-28-f053-queue-steer.md)
- 截图：`docs/design/F053/f053-queue-strip-1440.png`、
  `f053-steer-dialog-1440.png`、`f053-steer-dialog-390.png`、
  `f053-steer-guided-1440.png`。
- daemon 569 passed / 5 skipped；web 26 files / 129 tests + tsc/vite build。
- fullstack guide/interrupt 2/2（真实 pi worker + mock Anthropic）。
- 合入与部署：PR #276 merged `a8f9aefa2`；砚砚 approve @ `d5876c62a`，CI 5/5；
  runtime 3005/3014 已重启到 `a8f9aefa2`，health `ready`。

## 分阶段

| Phase | 内容 | 出口 |
|---|---|---|
| P1 | Registry + RPC steer + service + route + daemon tests | guide/interrupt 服务级绿 |
| P2 | Web QueueStrip + dialog + store/API + web tests | 操作面可用 |
| P3 | Fullstack E2E（真实 worker/mock provider）+ 隔离实机预览 | 真实链路证据 |
| P4 | review + docs + 部署 | 非作者 review + runtime 验证 |

## 风险

- **取消竞态**：interrupt 先 cancel 再 processEntry；旧 worker 可能短暂占用，processor
  会 release claim + 稍后重试。不得 double-start。
- **guide 注入时机**：pi steer 只保证在当前 assistant turn 的工具调用结束后、
  下一次 LLM 调用前注入；不是硬中断 provider 请求。这是 Clowder 同款语义。
- **进程内 registry**：daemon 重启后 registry 为空；guide 返回 `no_active_turn`，
  不伪造已注入。durable truth 仍是 TurnExecution。
- **多目标非原子**：v1 顺序提交；某目标失败不回滚已成功的 sibling（与 Clowder
  per-target 独立终局一致）。

## P3 已知窄窗口（review 记录）

guide 的 claim TTL 为 15s；若 `steer` RPC 挂起超过 TTL，claim 过期后
`retireTargets` 返回 `state_changed`，服务返回 typed `steer_failed`，但消息内容
可能已经注入活 turn，Queue target 仍 pending → 理论双投窗口。本地 RPC 正常远低于
15s；失败会诚实浮出，operator 可改走 interrupt。当前不作为阻塞项，记录待后续
引入可撤销的 steer ACK 或更长 claim fence。

## 证据

- 计划：`docs/plans/0053-queue-steer.md`
- 报告：`docs/reports/2026-11-28-f053-queue-steer.md`（执行时创建）
- 参考：Clowder `docs/features/F047-queue-steer.md`、
  `packages/web/src/components/SteerQueuedEntryModal.tsx`

[宪宪/deepseek-flash🐾]
