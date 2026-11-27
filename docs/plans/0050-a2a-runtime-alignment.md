---
title: "A2A runtime alignment plan — 0007 target / 0019 as-built"
doc_kind: plan
status: draft-for-review
created: 2026-11-27
updated: 2026-11-27
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: [墨墨 (Qwen 3.8 Flash), 砚砚 (GLM 5.3 Flash)]
related_features: [superagentteam/F044, superagentteam/F045, superagentteam/F046, superagentteam/F047, superagentteam/F048]
source_decision: "operator 2026-11-27: F043 是架构偏移上的补丁；按 0007/0019 的 Clowder 整体设计建计划、拆 feature；每个 feature 先读 0007/0019，避免逐 feature 偏移"
---

# A2A runtime alignment plan

## 0. 强制前置阅读

本计划下的每个 feature（F044–F048）在写设计、改代码、发 review 之前必须先读：

1. [`0007-a2a-runtime-chain.md`](../architecture/0007-a2a-runtime-chain.md)：Clowder-aligned **target contract**（route 层、T1–T4、multi_mention、验收）。
2. [`0019-a2a-runtime-chain-as-built.md`](../architecture/0019-a2a-runtime-chain-as-built.md)：当前 **as-built 真相**、deviation register、整改决策。
3. 本计划：feature 切片、依赖、禁止事项。

> **编号说明**：operator 所指的 “0008 as-built” 原文件名为
> `0008-a2a-runtime-chain-as-built.md`；因与已有 `0008-agent-config.md` 撞号，已改为
> `0019-a2a-runtime-chain-as-built.md`。本计划及后续 feature 统一引用 0007 + 0019。

每个 feature 文档顶部必须带同样的“先读”块；只允许实现本计划定义的切片，不允许在
feature 内另造一套与 0007 冲突的调度/上下文/多 mention 设计。发现 0007 确实需要
偏离时，先更新本计划与 0019，并拿到 operator/owner 决定，再进实现。

## 1. 为什么重做

F043 是在 architecture drift 上做的缝补：它把 multi-target 并发、context 快照、
post_message 自动投递和 UI 收敛分别补在 `QueueProcessor` / `RunAgentTurn` /
`DaemonA2A.tick` / 前端上。每一处单独看有理，但没有恢复 0007 的整体 ownership，
所以会继续产生“补一个点、另一个点又偏”的问题。

operator 2026-11-27 的方向：

- 回到 Clowder 的整体设计复用，不再在 drift 上继续打补丁。
- Clowder 的并行 route 在批次边界先完成所有 target 的 context 装配，再启动任何
  provider invocation，所以“C 看到 A/B 的回答”在设计上不会发生，不是靠事后过滤。
- `routeSerial` 即使退化为一个 target，也保留必要的前后处理：worklist、context、
  response commit、A2A successor、cleanup；不能因为单 target 就绕过 route 层。

## 2. Target architecture（来自 0007）

### 2.1 Route 层

```text
QueueProcessor（Phase A / claim / tracker / T3）
  → AgentRouter.resolveTargets(...)
  → AgentRouter.routeAgents(input, mode)
       ├─ routeParallel: 批次内所有 target 的 context 装配完成后再启动 streams
       └─ routeSerial:   顺序 target；后一个 target 可见前一个的已提交 response
  → runAgentTurn（per-target composition root；Phase B + T1）
  → RouteResponseCommitter（T2：R terminal + draft delete + attempt settled + A2A successor）
  → QueueProcessor T3（collector / parent aggregate / queue / retry / slot）
```

### 2.2 关键语义

1. **Parallel context barrier**：`routeParallel` 先在批次边界完成所有 target 的
   history/context 装配（Clowder 参考实现的 setup 阶段），再启动任何 invocation
   stream。同一批 target 的回答互相不可见；这是结构性保证，不是 per-turn 过滤。
2. **Serial 前后处理**：`routeSerial` 是**单 target operator/A2A hop** 的 route；
   即使只有一个 target，也保留 worklist、context、T2、A2A successor、cleanup。
   多 target operator message 恒走 `routeParallel`；`priorResponses` 仍按 0007 实现，
   供 route 契约/多 target 测试与未来 worklist 使用，但不是 v1 多 target 产品路径。
   单 target operator message 不直接调用 `runAgentTurn`。
3. **Ownership**：T1 = `runAgentTurn`/`invokeSingleAgent`；T2 = route/
   `RouteResponseCommitter`；T3 = `QueueProcessor`；T4 = `ResponseRecoveryService`。
   `runAgentTurn` 不写 parent aggregate；QueueProcessor 不写 R terminal/draft delete。
4. **Multi-mention**：`MultiMentionOrchestrator` 的 group lifecycle、aggregate system
   message、callback child、status read 按 0007 §3.8；target 的回答自动汇总给
   `callbackTo`（通常是 initiator），不靠 target 再发 `post_message`。
5. **Daemon 并发**：独立 queue entry 不被长 turn 阻塞；per-(thread, agent) slot 仍
   保证同 agent 顺序；并发有上界，不用全局 single-flight 换简单。
6. **Message surface**：A2A 私有消息默认收成“投递回执行”或无头像私有气泡；
   multi-mention burst 归入汇总卡，不与公开回复混淆。

## 3. 当前偏差（0019）与处置

| 偏差 | 0019 记录 | 本计划处置 | Feature |
|---|---|---|---|
| R1 route 层缺失 | `AgentRouter`/`routeAgents`/`routeParallel`/`routeSerial` target-only | 恢复 route 层，作为唯一调度路径 | F044 |
| R2 Phase B/T2 ownership | Phase B 在 QueueProcessor，T2 在 RunAgentTurn | 按 0007 移回 runAgentTurn/route；T3 留 QueueProcessor | F044 |
| R3 runAgentTurn 接口 | 实际是 `dispatch(prepared): Promise<void>`，无 `AgentTurnResult` | 引入 route 需要的 result/stream 契约 | F044 |
| R4 routeSerial/priorResponses | 未实现 | 实现 thin routeSerial + 单 target 前后处理 | F044 |
| R5 组件 API/deps | as-built 与 0007 接口漂移 | 以 0007 为主，0019 记录实际映射 | F044/F048 |
| F043 补丁 | 并发/快照/auto-delivery/UI 分散 | 行为保留为回归要求，代码被 holistic 实现替换 | F044–F048 |

## 4. Design invariants（不可违反）

1. **单一调度真相**：live 不并行运行两套 scheduler/route。F044 在分支上完成并通过
   parity 后才切主路径；旧 inline fan-out 在同一 feature 内删除。
2. **Parallel barrier 不是可选项**：任何“先启动再过滤 sibling response”的实现都
   视为 F043 式补丁，review 直接退回。
3. **Single target 也走 routeSerial**：不能以“只有一个 target”为由绕过 worklist、
   context、T2、A2A successor、cleanup。
4. **T2 只在 route/RouteResponseCommitter**：禁止 RunAgentTurn 和 QueueProcessor
   双写 R terminal。
5. **A2A successor 必须在 response durable commit 之后** admission；不能先 wake
   再补 commit。
6. **F043 的行为是回归要求，不是设计来源**：multi-target 并发、sibling 不可见、
   长 turn 不阻塞、源消息可读、auto-delivery、UI A/C 都要在新设计里重新验证。
7. **每个 feature 先读 0007/0019 并回链本计划**；PR/feature 文档缺这个块视为
   review blocker。

## 5. Feature 拆分

| Feature | 交付 | 依赖 | 主要验收 |
|---|---|---|---|
| F044 | Route 层恢复：AgentRouter/routeAgents/routeParallel/routeSerial、parallel context barrier、单 target serial 前后处理、T2 ownership | 无（第一棒） | parallel 无 sibling 泄漏；serial priorResponses/单 target 前后处理；T1/T2/T3 matrix |
| F045 | Delivery & multi-mention parity：post_message 源消息、aggregate/callback/status、auto-delivery 拒绝 | F044 | 源消息可读；一次 aggregate + callback；无额外 wake |
| F046 | Concurrency & queue parity：bounded concurrent drain、per-agent slot、长 turn 不阻塞、queue/live 读模型 | F044 | A 长跑时 B 独立 entry 可启动；queue 只显示真实等待 |
| F047 | Message surface parity：A2A 私有气泡、multi-mention 汇总卡、桌面/移动/光暗 | F044/F045 | AC-4 视觉验收；不散落气泡 |
| F048 | Parity guard & live acceptance：Clowder parity suite、architecture delta guard、隔离 live E2E、0019 收口 | F044–F047 | parity 全绿；live 四场景 + serial 单 target；operator 验收 |

### F044 · Route 层恢复（核心）

- `AgentRouter` + `routeAgents(mode)`；`routeParallel` 先装配全部 target context，
  再启动 streams；`routeSerial` 顺序执行并保留 per-target 前后处理。
- `RouteResponseCommitter` 拥有 T2；Phase B 与 T1 回到 `runAgentTurn`；
  QueueProcessor 只保留 Phase A/T3。
- 删除 `processEntry` 的 inline fan-out 与 `RunAgentTurn` 内的 T2 写入；不做双写。
- 回归 F043 AC-1（并发 + 无 sibling response）与 AC-2（独立 entry 不阻塞；后者与
  F046 联合验收）。

### F045 · Delivery & multi-mention parity

- `post_message` 的 target prompt 必须显式包含源消息；cursor 已越过源 seq 时也不能
  出现空窗口。
- 按 0007 §3.8 完成/核对 `MultiMentionOrchestrator`：aggregate system message、
  callback child、status read、timeout、anti-cascade。
- multi-mention target 向 initiator 的重复 `post_message` 在创建 message/queue 前
  拒绝（`multi_mention_auto_delivery`）；提示词明确“回答自动汇总，不需要 post_message”。
- 回归 F043 AC-3。

### F046 · Concurrency & queue parity

- `DaemonA2A.tick` 从全局 single-flight 改为有界并发 drain；同 agent 仍由 tracker
  slot 保证顺序。
- 长 turn 不阻塞独立 target/entry；queue/live 读模型只显示真正等待的投递。
- 并发上界、worker capacity、backpressure 与失败收敛按 0007/0016。
- 回归 F043 AC-2。

### F047 · Message surface parity

- A2A 私有消息用无头像私有气泡/“投递回执行”收敛；multi-mention burst 用汇总卡，
  不散落成多个公开回复气泡。
- 复用 F043 已选设计 A + C，并消费 F044/F045 的 lifecycle/`extra.multiMention` 元数据。
- 1440/390、浅色/深色截图；operator 视觉验收。

### F048 · Parity guard & live acceptance

- 建立 Clowder parity suite：parallel barrier、serial priorResponses、单 target
  route 前后处理、T2 ownership、A2A successor、multi-mention callback/auto-delivery、
  daemon 并发；每个测试回链 0007 章节。
- PR 模板/quality-gate 增加 “architecture as-built delta” 检查：触及 runtime 的 PR
  必须说明 0007/0019 的差异与处置；feature 文档必须带强制先读块。
- 隔离 test runtime（3007/3016）跑 F043 四场景 + 单 target serial + multi-mention
  callback；operator 授权后再上 runtime（3005/3014）。
- 更新 0019 为最终 as-built，F043 标 superseded。

## 6. 执行顺序与切换

```text
P0 计划/feature/BACKLOG（本 PR）
  ↓
P1 F044 route 层（分支；parity + T1–T4 matrix；不切 live）
  ↓
P2 F045 与 F046 并行（都基于 F044 route）
  ↓
P3 F047 前端（消费 F044/F045 元数据）
  ↓
P4 F048 guard + 隔离 live + operator 验收 + 0019 收口
```

- **原子切换**：F044 完成前不切 live；切换时一次性移除旧 inline fan-out/RunAgentTurn
  T2，不保留第二套 scheduler。
- **回滚**：每个 feature 独立分支；切换前保留 main 的旧实现作为 revert 目标；
  不做破坏性 schema 变更；live 部署需 operator 明确授权。
- **隔离数据**：测试只用 test runtime（3007/3016）；不碰 runtime 用户数据。

## 7. F043 处置

F043 **作为设计被本计划取代**，不再在其上追加补丁。它的 live 验证行为保留为回归要求：

1. multi-mention 多 target 并发启动，且 target 不看到同批 sibling 回答。
2. 长 turn 不阻塞独立 agent/entry。
3. `post_message` 目标能读到源消息，不出现“无新消息”空转。
4. A2A 私有消息/汇总卡不冒充公开回复。
5. daemon/web tests、typecheck、doc-index、非作者 review。

F043 文档加 superseded banner；AC-4 移到 F047，AC-1/2/3/5 分别由 F044/F046/F045/F048
覆盖。F043 的代码在 F044 切换时删除，不长期保留双路径。

## 8. 验证与证据

- **复用卡**：`docs/reuse/dispatch.md` 是 R0 直接复用契约；其风险 P1 明确
  “只复用 Queue、重写 routeSerial/routeParallel，会丢掉 A2A chain/worklist/
  parallel ideate/response 聚合”。本计划正是关闭这个风险。
- **Parity suite**：Clowder 参考实现的 route-parallel setup barrier、route-serial
  worklist/commit 语义、single-target serial、T2/A2A successor；测试名回链 0007 章节。
- **T1–T4 matrix**：每个 owner 的写入/不写入边界；重点 T2 不双写、T3 不提前 aggregate。
- **F043 regressions**：AC-1/2/3 + UI AC-4。
- **Live**：隔离 test runtime 先跑；runtime 需 operator 授权；记录 revision/URL/结果。
- **Docs/CI**：doc-index、typecheck、daemon/web tests、非作者 review。

## 9. 风险

- **Route 重构高风险**：核心执行路径；用 parity + T1–T4 + F043 回归覆盖，分支内完成，
  不 live 半切。
- **T2 ownership 迁移**：最易出现双写/漏写；F044 单独矩阵验证，禁止 RunAgentTurn
  保留 T2 写路径。
- **Parallel barrier 延迟**：所有 target context 装配后才启动；测量首 token 延迟，
  但不以延迟为由退回 per-turn 过滤。
- **并发放大**：F046 必须有上界/backpressure；per-agent slot 不放宽。
- **multi_mention callback 递归**：按 0007 depth ≤ 2 / anti-cascade；F045 覆盖。
- **文档漂移**：F048 guard + 每 feature 强制先读 0007/0019。

## 10. 待 operator 确认

- Feature owner/reviewer 分工（本计划默认：F044/F045/F046 宪宪；F047 墨墨；F048 宪宪+墨墨；
  review 按风险找非作者）。
- 是否允许 F044 在分支完成 parity 后直接切 runtime，还是先只在隔离 test runtime
  跑一轮再切。

[宪宪/deepseek-flash🐾]
