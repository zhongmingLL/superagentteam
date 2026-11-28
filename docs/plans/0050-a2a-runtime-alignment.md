---
title: "A2A runtime alignment plan — 0007 target / 0019 as-built"
doc_kind: plan
status: done
created: 2026-11-27
updated: 2026-11-28
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: [墨墨 (Qwen 3.8 Flash), 砚砚 (GLM 5.3 Flash)]
related_features: [superagentteam/F044, superagentteam/F045, superagentteam/F046, superagentteam/F047, superagentteam/F048, superagentteam/F049, superagentteam/F050, superagentteam/F051]
source_decision: "operator 2026-11-27: 纠正所有当前实现与 0007 的偏移，不只修 F043；按 0007/0019 建计划、拆 feature；每个 feature 先读 0007/0019，避免逐 feature 偏移"
---

# A2A runtime alignment plan

## 0. 强制前置阅读

本计划下的每个 feature（F044–F051）在写设计、改代码、发 review 之前必须先读：

1. [`0007-a2a-runtime-chain.md`](../architecture/0007-a2a-runtime-chain.md)：Clowder-aligned **target contract**。
2. [`0019-a2a-runtime-chain-as-built.md`](../architecture/0019-a2a-runtime-chain-as-built.md)：当前 **as-built 真相**、deviation register、整改决策。
3. [`2026-11-27-0007-as-built-audit.md`](../reports/2026-11-27-0007-as-built-audit.md)：A–F 全量偏移证据。
4. [`2026-11-27-0007-component-completeness.md`](../reports/2026-11-27-0007-component-completeness.md)：组件齐全性/命名映射复核。
5. 本计划：feature 切片与覆盖矩阵。

> **编号说明**：operator 所指的 “0008 as-built” 原文件名为
> `0008-a2a-runtime-chain-as-built.md`；因与已有 `0008-agent-config.md` 撞号，已改为
> `0019-a2a-runtime-chain-as-built.md`。本计划统一引用 0007 + 0019 + audit。

每个 feature 文档顶部必须带同样的“先读”块；只允许实现本计划定义的切片，不允许在
feature 内另造与 0007 冲突的调度/上下文/工具/数据设计。发现 0007 确实需要偏离时，
先更新本计划与 0019，并拿到 operator/owner 决定，再进实现。

## 1. 为什么重做

上一版拆分把“修 F043”当成了组织轴，这是错的。operator 2026-11-27 明确：

- 目标是纠正 **所有当前实现与 0007 的偏移**，不是只修 F043 暴露的四个问题。
- F043 是 architecture drift 上的缝补；它的行为要保留为回归要求，但不能作为设计轴。
- Clowder 的整体 route 设计要复用：并行 route 在批次边界先完成所有 target 的 context
  装配，再启动任何 provider invocation；`routeSerial` 即使只有一个 target，也保留
  worklist、context、response commit、A2A successor、cleanup。

本计划以 audit 的 A–F 表为覆盖底稿；F043 只占其中一小块。

## 2. Target architecture（来自 0007）

### 2.1 Route 层

```text
QueueProcessor（Phase A / claim / tracker / T3）
  → AgentRouter.resolveTargets(...)
  → AgentRouter.routeAgents(input, mode)
       ├─ routeParallel: 批次内所有 target 的 context 装配完成后再启动 streams
       └─ routeSerial:   单 target operator/A2A hop；保留 route 前后处理
  → runAgentTurn（per-target composition root；Phase B + T1）
  → RouteResponseCommitter（T2：R terminal + draft delete + attempt settled + successor）
  → QueueProcessor T3（collector / parent aggregate / queue / retry / slot）
```

### 2.2 关键语义

1. **Parallel context barrier**：`routeParallel` 先在批次边界完成所有 target 的
   history/context 装配，再启动任何 invocation stream；同批 target 的回答互相不可见。
2. **Serial 前后处理**：`routeSerial` 是单 target operator/A2A hop 的 route；即使只有
   一个 target，也保留 worklist、context、T2、A2A successor、cleanup。多 target
   operator message 恒走 `routeParallel`；`priorResponses` 仍按 0007 实现。
3. **Ownership**：T1 = `runAgentTurn`/`invokeSingleAgent`；T2 = route/
   `RouteResponseCommitter`；T3 = `QueueProcessor`；T4 = `ResponseRecoveryService`。
4. **Multi-mention**：`MultiMentionOrchestrator` 的 group lifecycle、aggregate、callback、
   status、timeout、anti-cascade 按 0007 §3.8；target 回答自动汇总，不靠再发 `post_message`。
5. **Daemon 并发**：独立 queue entry 不被长 turn 阻塞；per-(thread, agent) slot 保证
   同 agent 顺序；并发有上界。
6. **Data/API**：DDL、组件 API、命名按 0007；as-built 差异要么修实现，要么在 0019
   记录为有证据的 decision。
7. **Message surface**：A2A 私有消息与 multi-mention burst 不冒充公开回复。

## 3. 全量偏移覆盖矩阵（audit A–F）

> 每个 audit 行都必须有处置；不能只覆盖 F043 相关项。

| Audit | 偏移 | Feature | 处置 |
|---|---|---|---|
| A1 | `AgentRouter`/`routeAgents`/`routeParallel`/`routeSerial`/`priorResponses` 不存在 | F044 | 恢复 route 层 |
| A2 | Phase B 在 QueueProcessor，不在 runAgentTurn | F044 | 按 0007 移回 runAgentTurn |
| A3 | T2 在 RunAgentTurn，不在 route/RouteResponseCommitter | F044 | T2 owner 改为 route |
| A4 | runAgentTurn 是 `dispatch(): Promise<void>`，无 generator/AgentTurnResult | F044 | 引入 route 需要的 stream/result 契约 |
| A5 | `invoke-single-agent` 独立组件不存在 | F044/F047 | 实现或明确映射，文档记录 |
| A6 | T2 的 A2A successor 语义与 tool-time successor 不一致 | F044/F046 | route commit + post_message successor 统一 |
| A7 | 实际流程 QueueProcessor Phase A/B → RunAgentTurn；无 routeAgents/invoke-single-agent | F044 | 恢复 0007 流程 |
| A8 | 无 routeAgents per-child signal / serial acceptance | F044 | route signal + serial 契约 |
| A9 | F043 的 trigger snapshot / 并发 fan-out / auto-delivery 未进 0007 | F045/F046/F050 | 行为进 target/acceptance，代码进 F045/F046 |
| B1 | QueueProcessorDeps 与 0007 不一致（无 router/terminal/log，多 dispatchTarget 等） | F044/F048 | 按 route/并发拆分重建 deps |
| B2 | QueueProcessor 方法面不一致（无 requestDrain/processNext/recoverStartup 等） | F044/F048 | 恢复方法面 |
| B3 | InvocationRecordStore 方法面不一致 | F047 | store API 对齐或记录映射 |
| B4 | InvocationTracker API/返回值不一致 | F048 | tracker API 对齐 |
| B5 | tracker 抢占不写旧 TurnExecution terminal | F048 | 明确 owner 或补收敛 |
| B6 | `PerAgentTerminalDispositionCollector` class → function | F047 | 命名/接口映射 |
| B7 | `InvocationRegistry` → `InvocationCredentialStore` | F047 | 命名映射 |
| B8 | RouteResponseCommitter.commit 签名不一致 | F044 | 按 route result 契约对齐 |
| B9 | `InvocationQueue` 服务与 `QueueLedgerStore` 合并 | F047 | 拆薄服务层或明确 store-as-service 映射 |
| C1 | `response_drafts.rich_blocks_json` 未进 0007 | F047 | 0007 DDL 补列 + 0019 记录 |
| C2 | `source_record_id` 唯一约束写错 | F047 | 0007 SQL/验收改为 `(thread_id, source_record_id)` |
| C3 | `owner_json`/`from_json` CHECK 缺 `json_type='object'` | F047 | 0007 DDL 对齐 |
| C4 | §4 不是完整 schema 清单 | F047 | 补交叉引用/边界说明 |
| D1 | F031 rich block producer tool 未进 0007 工具面 | F046 | 文档记录独立 tool surface |
| D2 | F043 `multi_mention_auto_delivery` 未进 0007 | F046 | 行为进 target/0019 |
| D3 | F043 multi_mention prompt 模板未进 0007 | F046 | 文档补模板 |
| D6 | `MessageDispatchSummary` 文档声称 F018 拥有，代码没有 | F046 | 实现或明确 deferred |
| E1 | `sourceRecordId` unique 验收措辞不一致 | F047 | §9.2 改为 thread-scoped |
| E2 | preflight invalid reasons 缺 workspace/session | F048 | 0019 §8 D4 已修代码；补验收/回归 |
| E3 | routeAgents parallel/serial 验收按字面不可执行 | F044 | 按恢复后的 route 重写验收 |
| E4 | T2 contentBlocks/richBlocks/A2A successor 描述与实现不一致 | F044/F047 | route commit + 0007 文档对齐 |
| F1–F4 | InvocationRegistry / collector / runAgentTurn / RouteInput 等命名 | F047 | 0019 映射或代码命名对齐 |
| F5 | MessageDispatchSummary 无实现 | F046 | 同 D6 |
| F8 | `MultiMentionStatusReader` → `statusView` 命名/接口映射 | F046/F047 | 验证 status read 语义并记录映射 |
| F6–F7 | routing_guard / a2a_requests legacy 不对齐 | F050 | 记录为 aligned/no action |

**已核对对齐、不进入整改的项**：C5/C6（attempts/credential/read state/workers DDL）、
D4/D5/D7–D9（tool targets/上限/read model）、E5（auth/recovery/userId invariants）、
F6–F7（legacy no-action）。由 F050 在 parity/验收记录中确认。

## 4. Design invariants（不可违反）

1. **单一调度真相**：live 不并行运行两套 scheduler/route。F044 在分支上完成并通过
   parity 后才切主路径；旧 inline fan-out 在同一 feature 内删除。
2. **Parallel barrier 不是可选项**：任何“先启动再过滤 sibling response”的实现都
   视为 F043 式补丁，review 直接退回。
3. **Single target 也走 routeSerial**：不能以“只有一个 target”为由绕过 worklist、
   context、T2、A2A successor、cleanup。
4. **T2 只在 route/RouteResponseCommitter**：禁止 RunAgentTurn 和 QueueProcessor
   双写 R terminal。
5. **A2A successor 必须在 response durable commit 之后** admission。
6. **每个 audit A–F 行都有处置**：修复、文档对齐、显式映射或 no-action 证据；不能漏。
   owner/API/DDL/naming 不是“只记录”：public contract 漂移改代码，DDL/验收改文档，
   纯命名做显式映射；不做无价值全仓 cosmetic rename。
7. **F043 的行为是回归要求，不是设计来源**：后端行为并入 F045/F046/F048；AC-4
   前端按 operator 2026-11-27 指示作为 F043 内容补做（F049 superseded）。
8. **每个 feature 先读 0007/0019/audit 并回链本计划**；缺这个块视为 review blocker。

## 5. Feature 拆分

| Feature | 覆盖 audit | 交付 | 依赖 |
|---|---|---|---|
| F044 | A1–A8, B1/B2/B8, E3/E4 | Route & execution ownership：AgentRouter/routeParallel/routeSerial、parallel barrier、单 target serial 前后处理、Phase B/T1/T2 ownership、QueueProcessor route deps/methods | 无（第一棒） |
| F045 | A9(context) | Context/history parity：delivery cursor、`upToSeq`、`includeSourceMessageId`、post_message 源消息 | F044 |
| F046 | A9(auto-delivery), D1–D3, D6/F5 | A2A tools & multi-mention：rich block tool 文档、multi_mention aggregate/callback/status、auto-delivery、MessageDispatchSummary 决策 | F044/F045 |
| F047 | B3, B6/B7, B9, C1–C4, E1, E4(doc), F1–F4 | Data/API/naming parity：public contract 改代码，DDL/验收改文档，纯命名显式映射，B9 记录 decision | 可并行（部分依赖 F044/F048） |
| F048 | B2(methods), B4/B5, A8(concurrency), E2, E3(concurrency) | Queue/concurrency/recovery：bounded concurrent drain、tracker API/抢占、preflight invalid 验收、长 turn 不阻塞、recovery 边界 | F044 |
| F049 | F043 AC-4（superseded） | Message surface：按 operator 2026-11-27 指示作为 F043 AC-4 补做，不单独立项；后续 parity/visual guard 并入 F050 | — |
| F050 | 全表 + E1/E4 验收 | Parity guard & live：Clowder parity suite、architecture delta guard、隔离 live E2E、0019 收口 | F044–F048 + F043 AC-4 |
| F051 | 目录/组件落点 | Daemon module layout refactor：按 0020 移动/拆分目录，纯 mechanical，不改语义 | F044–F048 |

**共享项归属**：B2 的 `processEntry` 签名/route deps 由 F044，`requestDrain`/
`processNext`/`recoverStartup`/`onInvocationComplete` 由 F048；A8/E3 的 route signal/
serial 契约由 F044，daemon 并发验收由 F048；E4 的 T2 实现由 F044，文档措辞由 F047。

### 各 feature 的最小验收

- **F044**：parallel barrier 无 sibling 泄漏；单 target routeSerial 前后处理；T2 只由
  route 写；T1–T4 matrix；A2A successor after durable commit。
- **F045**：cursor 已越过源 seq 时 post_message 仍能读源消息；history snapshot 不把
  sibling response 带进来。
- **F046**：multi-mention 一次 aggregate + callback；target 重复 post_message 被拒；
  rich block tool 与 MessageDispatchSummary 的文档/实现处置明确。
- **F047**：DDL 与 live 对齐；store/命名 API 的 0007↔0019 映射完整；§9.2/§9.3 验收措辞
  不再自相矛盾。
- **F048**：A 长跑时 B 独立 entry 可启动；同 agent 顺序；queue/live 只显示真实等待；
  tracker 抢占/恢复边界有测试；preflight workspace/session typed invalid 回归。
- **F049（superseded）**：已由 F043 AC-4 实现 A+C；F049 不再单独实施，视觉验收归 F043。
- **F050**：parity suite 覆盖 A–F 整改项；PR/quality-gate guard；隔离 live + runtime
  验收；F043 AC-4 真实 Hub 截图（1440/390、光暗）；0019 最终 as-built。
- **F051**：target tree 落地、import 更新、layout guard；daemon full tests/typecheck
  通过；无行为/DDL/API 变化。

## 6. 执行顺序与切换

```text
P0 计划/feature/BACKLOG（本 PR）
  ↓
P1 F044 route & ownership（分支；parity + T1–T4 matrix；不切 live）
  ↓
P2 F045 context / F047 data-API-naming / F048 queue-concurrency（可并行，均以 F044 为锚）
  ↓
P3 F046 tools & multi-mention（依赖 F044/F045）
  ↓
P4 F043 AC-4 前端已实现（A+C；operator 视觉验收）
  ↓
P5 F051 daemon module layout（F044–F048 语义稳定后；纯 move/rename）
  ↓
P6 F050 parity guard + 隔离 live + operator 验收 + 0019 收口
```

- **原子切换**：F044 完成前不切 live；切换时一次性移除旧 inline fan-out/RunAgentTurn
  T2，不保留第二套 scheduler。
- **回滚**：每个 feature 独立分支；切换前保留 main 的旧实现作为 revert 目标；
  不做破坏性 schema 变更；live 部署需 operator 明确授权。
- **隔离数据**：测试只用 test runtime（3007/3016）；不碰 runtime 用户数据。

## 7. F043 处置

F043 **作为设计被本计划取代**；它的 live 验证行为只作为全量整改中的回归子集：

| F043 | 行为 | 新归属 |
|---|---|---|
| AC-1 | multi-mention 并发 + target 不看到同批 sibling | F044（barrier）+ F046（multi-mention） |
| AC-2 | 长 turn 不阻塞独立 entry | F048 |
| AC-3 | post_message 目标能读源消息 | F045 |
| AC-4 | A2A 私有气泡/汇总卡 | F043（operator 2026-11-27；F049 superseded） |
| AC-5 | tests/typecheck/review | 各 feature + F050 |

F043 文档加 superseded banner；不再在其上追加补丁。F043 的代码在 F044 切换时删除，
不长期保留双路径。

## 8. 验证与证据

> 方式基线：`docs/architecture/0021-e2e-acceptance-standard.md`（operator 对 F044
> 测试意图/方式的固化）。F044–F051 的 `AC-E2E` 均引用该标准。

- **当前测试 worktree E2E（operator 2026-11-27，强制）**：每个 feature 的功能验证必须在
  当前测试 worktree 的隔离 test runtime 跑真实端到端链路；**Clowder 是 golden**，按
  Clowder 参考实现/测试构建用例与断言；执行时观察并输出 daemon/worker/queue 日志关键行。
  unit/targeted test 只能补充，不能替代。证据须含 worktree/HEAD、隔离端口/data dir、
  用例、日志/输出、结果；无 E2E 证据不得声明 verified。
- **全量覆盖**：F050 逐行核对 audit A–F，记录 fixed / doc-aligned / no-action 证据。
- **Clowder parity suite**：parallel barrier、serial priorResponses、单 target serial、
  T2 ownership、A2A successor、multi-mention callback/auto-delivery、daemon 并发。
- **T1–T4 matrix**：每个 owner 的写入/不写入边界；重点 T2 不双写、T3 不提前 aggregate。
- **DDL/API parity**：C1–C3 与 live `sqlite_master` 对齐；B 表接口/命名映射完整。
- **F043 regressions**：AC-1/2/3 + UI AC-4。
- **Live**：隔离 test runtime 先跑；runtime 需 operator 授权；记录 revision/URL/结果。
- **复用卡**：`docs/reuse/dispatch.md` 的 P1 风险（只复用 Queue、重写 route 会丢
  A2A chain/worklist/response 聚合）必须在 F044 关闭。
- **组件齐全性**：`docs/reports/2026-11-27-0007-component-completeness.md` 逐项列出
  present/mapped/missing；B9/F8 已补入覆盖矩阵。

## 9. 风险

- **Route 重构高风险**：核心执行路径；分支内完成 parity + T1–T4 + F043 回归，不 live 半切。
- **T2 ownership 迁移**：最易双写/漏写；F044 单独矩阵验证，禁止 RunAgentTurn 保留 T2 写路径。
- **Parallel barrier 延迟**：所有 target context 装配后才启动；测量首 token 延迟，
  但不以延迟为由退回 per-turn 过滤。
- **Data/API 对齐**：DDL 只改文档/迁移脚本时，必须用 live schema 对账；不要用口头映射代替。
- **并发放大**：F048 必须有上界/backpressure；per-agent slot 不放宽。
- **multi_mention callback 递归**：按 0007 depth ≤ 2 / anti-cascade；F046 覆盖。
- **文档漂移**：F050 guard + 每 feature 强制先读 0007/0019/audit。

## 10. 收口状态与剩余 operator gate（2026-11-28）

工程面已收口：F044–F051 全部合入 `superagentteam-work`，每个 feature 有非作者
review 与 CI 5/5：

| Feature | PR / merge | Review |
|---|---|---|
| F044 | #244 `49658c23d` / #245 `695f85b3f` | 砚砚 approve @ `0062a35ae` |
| F045 | #249 `6b3ca58e8` | 砚砚 approve @ `f96f9f733` |
| F046 | #255 `2ef63f16a` / #256 `2443b1836` | 砚砚 approve @ `a8adbf458` / `6305468bd` |
| F047 | #254 `0dc8dcf7a` | 砚砚 approve @ `ea2b37826` |
| F048 | #253 `59f0ec53e` | 砚砚 approve @ `ae99d75e0` |
| F050 | #258 `b453703ee` | 砚砚 approve @ `6e3a3ec48` |
| F051 | #259 `fcbe0ac37` / #260 `87a9f7a2d` / #264 `e1d1dd38b` | 砚砚 approve @ `ec74c33d3` / `46f936e4b` |

已关闭（2026-11-28）：

- F050 AC-4b：真实 Hub 的 A2A 私有气泡/汇总卡 1440/390、光暗截图已补齐，operator 视觉签收。
- F050 AC-5：operator 明确授权部署；runtime 3005/3014 已运行 `e1d1dd38b`（含 F051c hotfix），健康与写路径验证通过。
- F044 runtime cut：随本次部署完成，不再另开切换决策。

剩余非目标限制：

- F037 P3：real provider 长尾/限流只覆盖单次成功回合，不外推为全矩阵稳定性。

## 11. Clowder 参考实现索引

> 路径相对 Clowder 参考仓根目录，不嵌入本机绝对路径。实现时读契约与流程，不复制
> store/transport；SuperAgentTeam 的 SQLite/HTTP/invoke 适配在 0007/0019 已定。

| Feature | 参考路径 | 重点 |
|---|---|---|
| F044 | `packages/api/src/domains/cats/services/agents/routing/AgentRouter.ts` | AgentRouter/routeAgents composition |
| F044 | `.../routing/route-parallel.ts` | parallel setup barrier、mergeStreams、单 target 错误隔离 |
| F044 | `.../routing/route-serial.ts` | serial loop、priorResponses、worklist、单 target 前后处理 |
| F044 | `.../routing/commit-completed-response.ts` | T2 response commit + A2A successor admission |
| F044 | `.../routing/response-terminal.ts` | response terminal 语义 |
| F044 | `.../invocation/invoke-single-cat.ts` | per-agent composition/T1 |
| F044 | `.../invocation/stream-merge.ts` | parallel stream merge |
| F045 | `.../services/context/ContextAssembler.ts` | context assembly |
| F045 | `.../routing/route-helpers.ts` | `assembleIncrementalContext`/`explicitPromptForIncrementalContext`/`collectExactPromptMessageIds` |
| F045 | `.../stores/message-delivery-boundary.ts` | delivery boundary |
| F045 | `.../stores/ports/DeliveryCursorStore.ts` | cursor contract |
| F045 | `.../invocation/context-continuity.ts` | context continuity |
| F046 | `packages/mcp-server/src/tools/callback-tools.ts` | post_message/cross_post_message/multi_mention tool schemas/handlers |
| F046 | `packages/api/src/routes/callbacks.ts` | post_message callback delivery |
| F046 | `packages/api/src/routes/callback-multi-mention-routes.ts` | multi_mention callback/status routes |
| F046 | `.../routing/MultiMentionOrchestrator.ts` | group lifecycle/aggregate/callback |
| F046 | `.../routing/multi-mention-state-machine.ts` | timeout/partial/anti-cascade |
| F046 | `.../routing/callback-post-result.ts` | callback result parsing |
| F047 | `.../invocation/InvocationQueue.ts` | InvocationQueue service |
| F047 | `.../invocation/queue-ledger/QueueLedger.ts` | ledger contract |
| F047 | `.../invocation/queue-ledger/QueueLedgerAdmission.ts` | admission/replay |
| F047 | `.../invocation/queue-ledger/RedisQueueLedgerStore.ts` | store adapter shape（只借契约） |
| F047 | `.../invocation/InvocationRegistry.ts` | invocation credential registry |
| F047 | `.../invocation/PerCatTerminalDispositionCollector.ts` | T3 collector |
| F047 | `.../invocation/InvocationSettlementProjection.ts` | settlement projection |
| F047 | `.../stores/ports/InvocationRecordStore.ts` / `TurnExecutionStore.ts` / `MessageStore.ts` | store API contracts |
| F048 | `.../invocation/QueueProcessor.ts` | requestDrain/processNext/drain/processEntry |
| F048 | `.../invocation/InvocationQueue.ts` | claim/retire/release |
| F048 | `.../invocation/InvocationTracker.ts` | per-cat slot/tracker |
| F048 | `.../invocation/InvocationOwnerReaper.ts` + `InvocationOwnerReaperInterval.ts` | owner reaper |
| F048 | `.../invocation/StartupReconciler.ts` + `TurnExecutionStartupReconciler.ts` | startup recovery |
| F048 | `.../invocation/queue-retry-deferrals.ts` / `queue-routing-recovery-policy.ts` | retry/defer/recovery |
| F048 | `packages/api/src/index.ts` | QueueProcessor composition root |
| F043 AC-4 | `packages/web/src/components/ChatMessage.tsx` | message bubble/direction pill |
| F043 AC-4 | `packages/web/src/lib/parse-direction.ts` | whisper/crossPost/mention direction |
| F043 AC-4 | `packages/web/src/components/thread-chat/single-cat-conversation-projection.ts` | private reverse link/grouping |
| F043 AC-4 | `packages/web/src/components/thread-chat/ThreadChatSurface.tsx` | thread surface |
| F043 AC-4 | `packages/web/src/components/thread-chat/SingleCatConversationTimeline.tsx` | timeline |
| F043 AC-4 | `packages/web/src/components/QueuePanel.tsx` | queue surface |
| F050 | `packages/api/test/route-parallel-*.test.js` / `route-serial-*.test.js` | route parity |
| F050 | `packages/api/test/invocation-queue.test.js` / `invocation-tracker.test.js` | queue/tracker parity |
| F050 | `packages/api/test/multi-mention-*.test.js` / `route-serial-callback-dedup.test.js` | multi-mention/callback |
| F050 | `packages/api/test/context-assembler.test.js` / `incremental-context-*.test.js` | context parity |
| F051 | `packages/api/src/domains/cats/services/{agents/routing,agents/invocation,agents/registry,context,stores}` | domain-first service/store 分层 |
| F051 | `packages/api/src/domains/messaging/{contract,stores}` | domain + ports 分层 |
| F051 | `packages/api/src/infrastructure/` | infrastructure 与 domain 分离 |
| F051 | `packages/api/src/index.ts` | composition root 外置 |
| F051 | `packages/mcp-server/src/tools/` | worker-side tool surface 独立 |

[宪宪/deepseek-flash🐾]
