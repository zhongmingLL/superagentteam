---
title: "A2A multi-mention / post_message / queue — live investigation"
doc_kind: report
status: done
created: 2026-11-27
updated: 2026-11-27
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
---

# A2A multi-mention / post_message / queue — live investigation

## 坐标

- live thread: `thread:ce5ff5a533505a5af063e27c85b42458`（a2a-测试）
- runtime: 3005/3014 @ `25dab74ff`（F041 部署）
- DB: `~/.superagentteam-runtime/data/f018.db`（只读查询）
- 参考实现: `/home/ming/agent/clowder-ai`（本地只读 checkout）

## 结论速览

| 问题 | 结论 | 性质 |
|---|---|---|
| Q1 post_message 额外唤醒 | 我们的 post_message 会 enqueue `message_wake`；D 的 delivery cursor 已越过源消息 seq，唤醒 turn 看到空窗口，于是连续回复"无新消息" | 投递语义 bug |
| Q2 C 声称"三家一致" | 不是幻觉：multi-mention 的 target 实际串行执行，C 的 prompt 在 A/B 完成后构建，读到了 A/B 的 response | 调度 + 上下文快照 bug |
| Q3 post_message 气泡 | 源消息是普通 `lifecycle.kind=input` agent 消息，前端按公开气泡渲染；没有收件人/A2A 语义，也没有归组 | 消息表面设计 |
| Q4 C 被 D 阻塞 | `DaemonA2A.tick` single-flight + `QueueProcessor.drain` await 完整 turn；D 的两分钟 turn 占住 drain，C 的独立 entry 只能等 | 调度 bug（与 Q2 同根） |

## Live 证据

### multi-mention（Q2）

同一 request `mm:95daa2b2-b683-4ba6-aac1-53b2a6f7ec02` 的三个 turn：

| target | started_at | ended_at | 实际耗时 |
|---|---|---|---|
| agentA | 1795742884359 | 1795742892331 | ~8.0s |
| agentB | 1795742884359 | 1795742930835 | ~46.5s |
| agentC | 1795742884359 | 1795742944550 | ~60.2s |

`started_at` 是 Phase B 创建 turn 的时间（三个 target 同一事务，时间相同），不是真实
provider 启动时间；`ended_at` 呈现明确的串行完成顺序：A → B → C。C 的 prompt 在
A/B 完成后才构建，`HistoryAssembler.loadHistory` 按 C 的 delivery cursor 取"之后"的消息，
A/B 的 response 对 C 可见（`visibleTo` 对 response 广播），所以 C 看到了 A/B 的结论。

### post_message（Q1）

- A/B/C 的 post_message 源消息 seq = 19/20/21；
- D 在 seq 23 的汇总 turn 之后 cursor 已推进到 22+；
- post_message 唤醒 D 产生的 seq 24/25/26 三条回复都是"暂未收到新消息 / 线程上下文为空"。

`HistoryAssembler.loadHistory` 只取 `seq > delivery_cursor` 的消息；19/20/21 低于 cursor，
所以唤醒 turn 的窗口为空。`post_message` 的 `message_wake` 本身是正常的，问题是目标
拿不到 exact source message。

### 队列（Q4）

- D 的两分钟 turn：`started 1795746697795` → `ended 1795746821258`（seq 37 触发）；
- operator @C 的消息 seq 40：`created 1795746774909`（D 运行期间）；
- C 的 invocation：`created 1795746821302`，即 D 结束后 44ms；C 的 response 随即出现。

说明 C 的 queue entry 在 D 运行期间一直 pending；不是 queue cap 的问题
（我们的 `QUEUE_CAP_PER_KIND = 5`，Clowder 用户消息 `MAX_QUEUE_DEPTH = 5`，同量级）。
真正原因是 drain 在等待 D 的完整 turn。

## Clowder 对照

### 调度（Q2/Q4）

- `packages/api/src/domains/cats/services/agents/invocation/InvocationTracker.ts`：
  槽位键是 `(threadId, catId)`，不同 cat 在同一 thread 可以并发；同 cat 才是单锁。
- `packages/api/src/domains/cats/services/agents/invocation/QueueProcessor.ts` 的
  `runDrain` 注释：一个 drain 只拥有一个 source entry，target set 作为一个 admission
  unit fan-out；durable handoff callback 再通知下一个 drain，
  **"without waiting for providers to finish their work"**。
- `MultiMentionOrchestrator.ts`：per-request dispatch controller，明确避开 per-thread
  单例 tracker 对并发 dispatch 的约束。

对照我们的实现：`DaemonA2A.tick` 是 single-flight，`QueueProcessor.drain` await
`RunAgentTurn.dispatch` 的完整 turn；`processEntry` 对 multi-mention 的多个 target 也是
`for ... await dispatch`。per-agent tracker 已经有了，但调度器没有用起来。

### 消息表面（Q3）

- `PersistedQueueDelivery.ts` §5.4：target-only payload "不在用户 Queue Panel 或聊天面板
  展示，只在被投递目标的 exact input 中可见"。
- `ChatMessage.tsx`：`origin === 'callback'` 的消息使用同一 per-cat surface token，
  但 ring 更轻（12% vs 30%）；whisper 消息有"悄悄话 → ..."标记、虚线边框和揭秘态；
  crossPost 消息有来源 thread 跳转 pill。

我们的 post_message 目前是普通 `input` 消息，公开气泡 + 无收件人标记；和 Clowder 的
callback/private/whisper 语义不对齐。

## 设计稿（Q3）

Pencil frame：`F043 · A2A message surface · 1440`（当前打开在 pen.dev，节点 `W98Yz9`）。
预览：`docs/design/F043/a2a-message-1440.png`。

三个候选：

- **方案 A · A2A 私有气泡**：保留完整内容；header 增加 `agentA → agentD` 收件人 pill、
  `A2A` 标记、轻边框；footer 显示"私人消息 · 已送达"与"展开全文"。
- **方案 B · 投递回执行**：默认收成 44px 一行（`A2A` + `agentA → agentD` + 时间 +
  展开箭头），点开才显示正文；对应 Clowder private delivery 的公开面。
- **方案 C · multi-mention 汇总卡**：把 3 条并行回答收进一张卡（question + 3 rows +
  3/3 状态 + 汇总去向），每条 post_message 作为卡内 `post_message → agentD` 附注，
  不再各占一个公开气泡。

建议：C 作为 multi-mention 的默认表面，B 作为普通 agent→agent post_message 的默认表面；
A 作为展开后的详情态。三者可组合，不互斥。

## 修复计划（建议）

**P0 · 调度与上下文（Q2/Q4）**

1. multi-mention 的 target dispatch 改为并发 fan-out（`Promise.allSettled`），复用
   `InvocationTracker.startAll` 的 per-cat 槽；失败按 target 收敛，不互相覆盖。
2. queue entry 固定触发消息快照：prompt history 的上界是触发消息 seq，并显式包含触发
   消息本身；不依赖目标 agent 的 delivery cursor。
3. drain 改为 handoff 式（provider 启动后释放 drain，完成时再走收敛/聚合），或至少允许
   同一 thread 的 drain 在 per-agent 槽可用时并发；需要补失败路径回归。

**P1 · post_message 投递（Q1）**

4. 唤醒 turn 必须把 queue entry 的 source message 作为 exact input 注入 prompt（即使
   低于 delivery cursor）；先修这条，空转回复会消失。
5. 评估 multi-mention 后续 post_message 的 no-wake/私有投递：目标已在汇总回调里拿到
   结果时，重复的 post_message 只保留为可展开附注，不再新开 turn。

**P2 · 消息表面（Q3）**

6. 按选定方案实现 A2A 消息表面；先做 C（汇总卡）+ B（回执行），A 作为展开态。
7. UI 需要区分 `origin=callback` / `visibility=private` / `crossPost`，并保留来源跳转。

## 适配实现（2026-11-27，按 operator A+C / route_parallel）

Clowder 深研后的映射：

| Clowder 机制 | 本仓适配 |
|---|---|
| `routeParallel` 对 targetCats 做 `Promise.all` | `QueueProcessor.processEntry` 对同一 entry 的全部 target 并发 `dispatch` |
| 共享触发视图 / `exactA2ATriggerMessageId` | `HistoryAssembler.loadHistory` 增加 `upToSeq` + `includeSourceMessageId`；`RunAgentTurn` 用 queue source 作为上界并显式包含源消息 |
| `runDrain` 不等 provider 完成 | `DaemonA2A.tick` 改为有界并发 drain（8）；per-(thread, agent) tracker 保证同 agent 单槽 |
| 多 target 完成事件自动聚合给 callbackTo | 已有 aggregate 保持不变；multi-mention target 的重复 post_message 被 `multi_mention_auto_delivery` 拒绝 |
| callback / private / whisper 消息表面 | 设计选定 A（无头像私有气泡）+ C（multi-mention 汇总卡）；前端待实现 |

有意差异：Clowder 的 drain 在 durable handoff 后释放，我们对每条 entry 仍 await 完整 turn，
但允许最多 8 条 drain 并行，因此长 turn 不会挡住其他 agent；这保留了现有失败收敛路径，
避免一次性重写 T3/aggregation。若未来并发规模需要，再演进为 handoff 回调。

验证：daemon 519 passed / 1 skipped；新增 history 快照、并发 fan-out、并发 drain、
auto-delivery 拒绝用例；typecheck 绿。

## 未验证边界

- Clowder 的 Smart Window / context projection 细节未逐行复刻；本报告只采用其
  "per-cat slot + handoff drain + exact trigger input" 的公开契约。
- 并发 fan-out 对 provider quota/worker pool 的影响需要在隔离栈压测后再上 live。
- Q3 的设计方向需要 operator 选定后再进入实现；本次只交设计稿与对比。
