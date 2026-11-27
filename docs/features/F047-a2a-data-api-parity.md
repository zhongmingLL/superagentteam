---
feature_ids: [superagentteam/F047]
related_features: [superagentteam/F018, superagentteam/F031, superagentteam/F044, superagentteam/F048, superagentteam/F050]
title: "F047: A2A data/API/naming parity"
status: planned
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: []
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-27
updated: 2026-11-27
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

**B3、B6/B7、C1–C4、E1、E4（doc 部分）、F1–F4**：

- B3：`InvocationRecordStore` 方法面与 0007 不一致。
- B6：`PerAgentTerminalDispositionCollector` class → function。
- B7：`InvocationRegistry` → `InvocationCredentialStore`。
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
- §9.3.1 T2 contentBlocks/richBlocks 描述对齐。

## 非目标

- 不改 route/T2 ownership（F044）。
- 不改 history/context（F045）。
- 不改 multi_mention 行为（F046）。
- 不改 daemon 并发（F048）。
- 不改 UI（F049）。

## 验收

- [ ] AC-1（C1–C3）：0007 DDL 与 live `sqlite_master` 对齐；rich_blocks_json、thread-scoped
  unique、json_type CHECK 三项有对账记录。
- [ ] AC-2（C4）：§4 schema 边界清楚；跨文档表引用不再被误读为 §4 完整清单。
- [ ] AC-3（B3/B6/B7/F1–F4）：store/组件/接口命名映射完整；0019 与 0007 不再互相矛盾。
- [ ] AC-4（E1/E4）：§9.2/§9.3 验收措辞与实现一致；richBlocks/T2 描述准确。
- [ ] AC-5：doc-index、typecheck、相关测试绿；非作者 review。

## 证据

- 0007 §3.3/§3.4/§3.7/§4/§9.2/§9.3.1。
- 0019 §4/§5/§7 R6/R9、audit B3/B6/B7/C1–C4/E1/E4/F1–F4。
- live DB `sqlite_master` / `pragma table_info` 对账（隔离 runtime）。

## 风险 / 回滚

- 只改文档/映射时，必须用 live schema 对账；不能用口头映射代替。
- 若 API 命名对齐需要改代码，按小步提交 + 测试；保持向后兼容或明确破坏窗口。
- 回滚：revert docs/API mapping；不删除持久化数据。

[宪宪/deepseek-flash🐾]
