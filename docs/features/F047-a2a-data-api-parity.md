---
feature_ids: [superagentteam/F047]
related_features: [superagentteam/F018, superagentteam/F031, superagentteam/F044, superagentteam/F048, superagentteam/F050]
title: "F047: A2A data/API/naming parity"
status: implemented
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: [砚砚 (GLM 5.3 Flash)]
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-27
updated: 2026-11-28
source_decision: "operator 2026-11-27: 纠正所有 0007↔当前实现偏移；DDL/API/命名按 0007 对齐，不留下文档自相矛盾"
---

# F047: A2A data/API/naming parity

> **先读（强制）**：
> - [`0007-a2a-runtime-chain.md`](../architecture/0007-a2a-runtime-chain.md)：target contract。
> - [`0019-a2a-runtime-chain-as-built.md`](../architecture/0019-a2a-runtime-chain-as-built.md)：当前 as-built，原 0008 as-built。
> - [`2026-11-27-0007-as-built-audit.md`](../reports/2026-11-27-0007-as-built-audit.md)：A–F 偏移证据。
> - [`0050-a2a-runtime-alignment.md`](../plans/0050-a2a-runtime-alignment.md)：本计划。
>
> 本 feature 只做数据/API/命名对齐；不得借机改 runtime 语义。

## 覆盖的 audit 偏移

**B3、B6/B7、B9、C1–C4、E1、E4（doc 部分）、F1–F4**：

- B3：`InvocationRecordStore` 方法面与 0007 不一致。
- B6：`PerAgentTerminalDispositionCollector` class → function。
- B7：`InvocationRegistry` → `InvocationCredentialStore`。
- B9：`InvocationQueue` 服务与 `QueueLedgerStore` 持久层合并。
- C1：`response_drafts.rich_blocks_json` 未进 0007 DDL。
- C2：`source_record_id` 唯一约束 SQL 写错。
- C3：`owner_json`/`from_json` CHECK 缺 `json_type='object'`。
- C4：§4 不是完整 schema 清单。
- E1：`sourceRecordId` unique 验收措辞不一致。
- E4：T2 contentBlocks/richBlocks 描述与实现不一致（doc 部分）。
- F1–F4：组件/接口命名漂移。

## Why

audit 显示，除了 route/context，0007 与 as-built 还有一批数据模型、store API、
命名和验收措辞的偏移。它们不一定改用户行为，但会让后续实现和 review 继续读错契约。
F047 用 live `sqlite_master`/代码签名逐项对账，修 DDL 文档、API 映射和命名；
无法对齐的实现差异在 0019 记录为有证据的 decision，不留“文档说有、代码没有”。

## 整改策略（本 feature 的判据）

“不是能力缺失”不等于“不用整改”。F047 对每类漂移给明确处置，不允许静默：

1. **public contract / consumer-facing API 漂移 → 改代码**：例如
   `InvocationRecordStore` 方法面、`RouteResponseCommitter.commit` 签名（与 F044 联合）、
   被其它 domain 直接依赖的 store/service 接口。消费者依赖的契约不能只写映射。
2. **DDL / 验收措辞 → 改文档/迁移**：C1–C3 以 live `sqlite_master` 为准修 0007；
   E1/E4 改验收措辞。不做无意义的数据迁移。
3. **纯命名漂移 → 显式映射，按需改名**：`InvocationRegistry`、
   `PerAgentTerminalDispositionCollector`、`runAgentTurn`、`RouteInput` 等历史名，
   在 0019 建映射表；只有“改名能减少真实歧义/缺陷”或文件本来就要动时才改代码，
   不做全仓 cosmetic rename。
4. **服务/store 合并（B9）→ 明确 decision**：`InvocationQueue` 与
   `QueueLedgerStore` 默认做一个薄 facade（服务层调用 store），或明确记录
   “v1 intentional merge + ownership/test boundary”；二选一必须写进 0019。
5. **每个 audit 行都有 disposition**：fixed / doc-aligned / documented mapping /
   no-action（with evidence）。没有“留着不管”。

## 用户结果

- 0007 的 DDL/验收与 live schema 一致：`rich_blocks_json`、`(thread_id,
  source_record_id)` unique、`json_type='object'` CHECK。
- 组件/Store API 的 0007↔0019 映射完整；命名漂移不再被误读为缺失能力。
- §9.2/§9.3 验收不再自相矛盾。

## 范围

- 0007 §4.3.2 `response_drafts` 补 `rich_blocks_json`（F031）。
- 0007 §4.2/§9.2 唯一约束改为 `(thread_id, source_record_id)`。
- 0007 `owner_json`/`from_json` CHECK 补 `json_type(...)='object'`。
- 0007 §4 schema 边界：补 `agent_sessions`/`threads`/`messages` 的交叉引用，避免“完整 schema”误解。
- `InvocationRecordStore` 方法面与 0007 对齐或写明确映射；`InvocationRegistry`/
  `InvocationCredentialStore`、`PerAgentTerminalDispositionCollector`/collector function、
  `runAgentTurn`/`RunAgentTurn`、`RouteInput`/`PreparedDispatch` 等命名映射。
- `InvocationQueue` vs `QueueLedgerStore`：拆薄服务层或明确 store-as-service 映射，
  记录 ownership/测试边界。
- §9.3.1 T2 contentBlocks/richBlocks 描述对齐。

## 非目标

- 不改 route/T2 ownership（F044）。
- 不改 history/context（F045）。
- 不改 multi_mention 行为（F046）。
- 不改 daemon 并发（F048）。
- 不改 UI（F049）。

## 验收

- [x] AC-1（C1–C3）：0007 DDL 与 live `sqlite_master` 对齐；rich_blocks_json、thread-scoped
  unique、json_type CHECK 三项有对账记录。
- [x] AC-2（C4）：§4 schema 边界清楚；跨文档表引用不再被误读为 §4 完整清单。
- [x] AC-3（B3/B6/B7/F1–F4）：store/组件/接口命名映射完整；0019 与 0007 不再互相矛盾。
- [x] AC-4（E1/E4）：§9.2/§9.3 验收措辞与实现一致；richBlocks/T2 描述准确。
- [x] AC-5：doc-index、typecheck、相关测试绿；非作者 review。
- [x] AC-6：0019/0007 的 B/F 映射表覆盖每一行；纯命名漂移都有显式 disposition，
  不出现静默漂移。
- [x] AC-7：B9 的 `InvocationQueue`/`QueueLedgerStore` decision 已记录（facade 或
  intentional merge），并有对应测试/ownership 说明。

- [x] AC-E2E（operator 2026-11-27，强制）：必须在**当前测试 worktree**的隔离 test runtime
  跑真实端到端链路；**Clowder 是 golden**，先按其 store/API/DDL 参考实现与测试构建
  用例和断言，再在本仓复现；执行时观察并输出 daemon/worker/queue 日志关键行；
  unit/targeted test 只能补充，不能替代。证据须含 worktree/HEAD、隔离端口/data dir、
  用例、日志/输出、结果；无 E2E 证据不得声明 verified。
  方式基线：[`0021-e2e-acceptance-standard.md`](../architecture/0021-e2e-acceptance-standard.md)
  （F044 方法）；DDL 要与 live schema 对账，store/API 变更要有真实链路证据。

## 证据

### 执行（2026-11-28）

- **C1/C2/C3 schema 对账**：`f047-schema-parity.test.ts` 在 fresh `mkdtemp` DB 上读取
  `sqlite_master`，断言 `response_drafts.rich_blocks_json`（array check）、
  `invocation_records UNIQUE(thread_id, source_record_id)`（且无列级全局 UNIQUE）、
  `invocation_queue owner_json/from_json json_type='object'`；并核对 §4 的 15 张 canonical
  表全部存在。1/1 passed。
- **C2/E4 文档修正**：0007 §4.2 去掉 `source_record_id` 列级 UNIQUE（保留表级
  thread-scoped 约束）；§4 增加 target/as-built 边界（0019 §4/§7 R6）；
  §9.3.1 T2 改为 content/thinking/toolEvents/richBlocks 来自 draft、contentBlocks 由消息
  投影派生。
- **B3/B6/B7/F1–F4 映射**：0019 §7 R9 增加 F047 disposition：
  `InvocationRecordStore` 方法映射、collector/credential store 命名、`runAgentTurn`/
  `PreparedDispatch` 映射；0007 §3.3 标 target-only 并指向 0019。
- **B9 decision**：0019 R9 明确 v1 intentional merge（store-as-service）：
  QueueLedgerStore 拥有 admission/claim/retire/release；QueueProcessor 拥有候选选择/
  Phase A/B/T3；测试边界 `f018-queue-ledger.test.ts` + `f018-r2a-dispatch.test.ts`。
- **AC-E2E 真实链路**：同一 worktree/HEAD 跑 `f044-route-fullstack-e2e.test.ts`
  **10/10**（真实 daemon + 真实 pi worker，R1–R4/R7/F048 并发）与 daemon full
  **551/4**；F047 只改文档/映射，不新增 runtime 语义，复用该真实链路作为
  schema/API 对齐的运行证据。

- **Clowder 参考路径**（相对参考仓根目录）：
  - `.../invocation/InvocationQueue.ts`
  - `.../invocation/queue-ledger/QueueLedger.ts`
  - `.../invocation/queue-ledger/QueueLedgerAdmission.ts`
  - `.../invocation/queue-ledger/RedisQueueLedgerStore.ts`（只借契约/分层）
  - `.../invocation/InvocationRegistry.ts`
  - `.../invocation/PerCatTerminalDispositionCollector.ts`
  - `.../invocation/InvocationSettlementProjection.ts`
  - `.../stores/ports/InvocationRecordStore.ts` / `TurnExecutionStore.ts` / `MessageStore.ts`
- 0007 §3.3/§3.4/§3.7/§4/§9.2/§9.3.1。
- 0019 §4/§5/§7 R6/R9、audit B3/B6/B7/C1–C4/E1/E4/F1–F4。
- live DB `sqlite_master` / `pragma table_info` 对账（隔离 runtime）。

## 风险 / 回滚

- 只改文档/映射时，必须用 live schema 对账；不能用口头映射代替。
- 若 API 命名对齐需要改代码，按小步提交 + 测试；保持向后兼容或明确破坏窗口。
- 回滚：revert docs/API mapping；不删除持久化数据。

[宪宪/deepseek-flash🐾]
