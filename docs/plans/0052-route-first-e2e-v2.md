---
title: "0052: Route-first E2E v2 — 0007 + F044 ownership 用例重设计"
doc_kind: plan
status: active
created: 2026-11-28
updated: 2026-11-28
source_decision: "operator 2026-11-27: 不要继续复用 F037 旧矩阵；按当前 0007/0019 + F044 纠正后的 ownership 重新设计真实前后端 E2E"
---

# 0052: Route-first E2E v2

## Why v2

F037 的矩阵建立在 F044 之前的 inline fan-out 上：它验证的是“功能存在”，不是 0007/F044
纠正后的 ownership、route barrier、Phase B 事务边界和 T2/T3 时序。2026-11-27 的
post-F044 revalidation 仍拿旧行号复跑，只换标签不换场景——operator 明确要求重设计。

v2 的原则：每个 case 对准当前 0007 ownership 的真实场景；R1/R4 额外断言 route 时代
才有的结构化日志事件（`phase_b_appended` / `turn_worker_bound` / `turn_terminal`），
作为与旧折叠实现的机械区分器。尚未实现的 target（例如 A2A successor 的
durable-commit admission，归 F046）显式标 known-gap。不使用 unit/targeted test
代替真实端到端证据。

## 来源

- 0007 §3.2（QueueProcessor Phase A/T3）、§3.5（AgentRouter/routeSerial/routeParallel）、
  §3.6（invoke-single-agent/TurnExecution）、§3.9（T1–T4）。
- 0019 as-built；F044 AC-1–6；plan 0050 §8（当前 worktree 强制 E2E）。
- Clowder 参考：`route-parallel.ts` setup barrier、`route-serial.ts` worklist、
  `commit-completed-response.ts` T2、`invoke-single-cat.ts` per-agent composition。

## 用例矩阵

> 层：B = 真实 daemon + 真实 pi worker + mock provider；U = 真实 Hub 前端 + 真实 daemon
> （provider 可为 mock 或 Kimi）；P = 真实 provider。
> 状态：`pass` / `partial` / `todo` / `known-gap`。

| ID | 层 | 场景 | 0007/F044 约束 | 证据 | 状态 |
|---|---|---|---|---|---|
| R1 | B | 多 target 并发，A 慢 B 快；B 先完成时 A 仍在运行 | routeParallel 先装配全部 context；per-target T1/T2 独立；T3 最后 aggregate | `f044-route-fullstack-e2e.test.ts` R1；DB：B handled/completed，A appended/running；B prompt 不含 A 回复；route 日志 events 各 ≥2 | pass |
| R2 | B/U | provider 在 prompt 接收后 500：T1 failed → UI 失败气泡 → 手动 retry → attempt 2 | delivered failure = T1 failed + ack，不自动 replay；retry 走 requestRetry/新 attempt | R2（mock 500）+ 真实 UI 401 失败/重试；DB attempt 1/2 均 failed，无 `delivery_failure` | pass |
| R3 | B/U | 运行中取消：真实 worker/provider 在飞时点停止 | cancel → turn/attempt/R canceled，worker retired，queue 不 restore | R3（mock 延迟）+ 真实 UI stop；DB 三态 canceled，worker retired | pass |
| R4 | B | `cross_post_message` thread1 → thread2，B 回复 | 新 queue entry/parent；source/target 归属正确；T3 各自收敛 | R4；target input 的 dispatchRef、两 parent completed；route 日志 events 各 ≥2 | pass |
| R5 | B | `multi_mention` B+C + callback A | F046 工具面；one source/parent + N turns；aggregate/callback | 设计已列，尚未自动化（F046） | todo |
| R6 | B | T2 单写者 / R 生命周期 | R terminal 只由 route/RouteResponseCommitter 写；draft delete、settlement settled | R1/R2 DB 断言（R status、draft null、settlement） | pass |
| R7 | B | Phase B 失败隔离（draft/credential/retire） | Phase B 失败 = attempt failed + delivery_failure + target pending；不进 provider convergence | `f044-route-fullstack-e2e.test.ts` R7 ×3：draft/credential/retire 各一例；attempt failed/terminal `phase_b_failed`、无 TurnExecution/R、delivery_failure reason 精确、target 仍 pending、provider 0 调用 | pass |
| P1 | P | live pi RPC 单 agent 真实回合 | 真实 pi worker + 真实 Kimi account；R completed | `f018-r3-live.e2e.test.ts`（runtime.env key 注入，不打印） | pass |
| P2 | U/P | 真实 Hub 单 agent | 真实 account/agent；`REAL_UI_OK`；DB R completed | `f044-ui-real-kimi-success.png`；DB attempt/turn/R completed | pass |
| P3 | U/P | 真实 Hub 多 target | agentA+agentB 同时回复；T2/T3 正常 | `f044-ui-real-kimi-multi-target.png`；两 parent completed | pass |
| R8 | B | A2A successor 只在 A 的 response durable commit 后 admission | 0007 §3.5 step 11 → successor；当前 tool-time `post_message` 仍提前 | 现状记录为 F044 AC-3 / F046 gap；不在 v2 声明 pass | known-gap |
| C1 | B | 并行 target 共享同一触发快照；sibling 回复互不可见 | 0007 §3.5.1 `upToSeq` = queue source；barrier 在批次边界装配 | `f045-context-history-e2e.test.ts` C1；两 attempt `deliveryBoundarySeq` = trigger seq；双向 prompt 无 sibling reply | pass（F045） |
| C2 | B | `post_message` 源 seq 低于目标 delivery cursor | 0007 §3.5.1 `includeSourceMessageId`；ack 不回退 | `f045-context-history-e2e.test.ts` C2；prompt 含源、不含已消费 later；ack = later tail | pass（F045） |
| U1 | U | 真实 Hub：创建 thread、@agentA、看到回复 | 真实前端 + 真实 daemon/worker；Phase B/T1/T2/T3 真跑 | `f044-ui-real-kimi-success.png`；真实 Kimi `REAL_UI_OK` | pass（真实 Kimi） |
| U2 | U | 真实 Hub：`@agentA @agentB` 多 target fan-out | 同一触发边界、两个回复、thread 成员 2 位 | `f044-ui-real-kimi-multi-target.png`；两个真实 `REAL_MULTI_OK` | pass（真实 Kimi） |
| U3 | U | 真实 Hub：运行中停止 | LivePill 停止 → “已取消”，queue 不 restore | `docs/design/F044/f044-ui-stop-canceled.png`；DB canceled | pass |
| U4 | U | 真实 Hub：provider 失败 + 重试 | 失败气泡 + retry；attempt 2；无假成功 | `docs/design/F044/f044-ui-provider-401-retry.png`；真实 Kimi 401 | pass（失败路径）；success path 未验证 |
| U5 | U | rich block / execution record | 最终消息保留 rich/tool/thinking | 旧 F037 截图仍是视觉证据，本轮未重跑 | todo |
| U6 | U | Settings 创建 account/agent | 无需重启、secret 不回显 | 旧 F037 证据；本轮未重跑 | todo |
| U7 | U | 1440/390 light/dark | 无横向滚动、键盘发送 | 旧 F037 截图；本轮未重拍 | todo |

## 执行纪律

- 只在隔离 test runtime：独立 data dir、test 端口 3007/3016；不读写 runtime
  3005/3014、`~/.superagentteam-runtime/data`。
- B 层使用真实 daemon API + 真实 pi worker 进程 + 本地 mock provider；
  U 层使用真实 Vite Hub + 真实 daemon；provider 成功路径用 mock，失败路径可用
  真实 Kimi（key 只注入 env，不打印）。
- 每个 case 记录：命令、HEAD、data dir、端口、关键日志行、DB 坐标/截图。
- 真实 provider 成功路径用 runtime `kimi` account 在隔离栈验证；没有 fresh 证据时
  不把旧结果外推，也不把 mock 当真实模型证据。

## 非目标

- 不实现 F046 的 successor admission / multi_mention；R5/R8 只记录边界。
- 不用 v2 替代 0007 契约；v2 是验证层。
- 不把 mock provider 当真实模型证据；真实 provider 单独标注。

## 结果

执行报告：`docs/reports/2026-11-28-f044-route-e2e-v2.md`。

- F045 context/history 续篇：C1/C2 在
  `packages/superagentteam-daemon/test/f045-context-history-e2e.test.ts`（2/2），
  同时把 0007 §3.5.1 trigger snapshot 契约补齐。
- R7 Phase B fault injection：`f044-route-fullstack-e2e.test.ts` 增 3 例
  （draft/credential/retire），fullstack 7/7。

[宪宪/deepseek-flash🐾]
