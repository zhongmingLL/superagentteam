---
title: "F054 Session chain & full seal — implementation report"
doc_kind: report
status: active
created: 2026-11-28
updated: 2026-11-28
source_decision: "operator 2026-11-28: 当前有 session chain / session seal 吗？没有的话参考 Clowder 复用设计实现"
---

# F054 Session chain & full seal — implementation report

## 背景

SAT 的 `AgentSession` 原先只有 lightweight seal（active→sealed + seq+1），没有
Clowder 的 chain 读模型、transcript/digest 或 UI。operator 要求对齐 Clowder 的
session chain / session seal 能力。

## Clowder 参考

- `SessionChainStore`：`(thread, cat)` 链，按 seq 排序，sealed 行保留；
- `SessionSealer`：`requestSeal`（active→sealing）+ `finalize`（transcript/digest
  + sealed）；
- `GET /api/threads/:threadId/sessions`、`POST /api/sessions/:sessionId/seal`；
- `SessionChainPanel`：链、状态、封存、摘要查看。

SAT v1 收敛为：只读链 + 手动同步 full seal + transcript/确定性 digest + Hub 面板；
不做自动阈值 seal、restore/unseal、LLM handoff digest。

## 实现

- **Schema**：migration 008 `session_artifacts`，每 sealed session 一条不可变
  transcript/digest 制品；含 `from_seq/to_seq/message_count/transcript_bytes`。
- **窗口**：`fromSeq = 上一 sealed artifact.toSeq + 1`，`toSeq = messages.latestSeq`；
  默认保留最新 400 条，超出标记 `truncated`；单条正文 3k 字符、摘要 excerpt 400。
- **Digest**：确定性 extractive：senders、tool usage、errors、first/last/recent。
- **Seal service**：owner/active/tracker/queue 校验；同一事务写 artifact +
  active→sealed + delivery cursor rewind 到 `max(0, toSeq - 200)`；失败回滚保持
  active；下一次 invocation `ensureActive` 创建 seq+1。
- **API**：chain/detail/transcript/seal；CSRF + typed 403/404/409。
- **Web**：topbar `Sessions` → `SessionChainDialog`；active 行封存、sealed 行摘要/
  transcript；封存后刷新链。

## 验证

- `f054-session-seal.test.ts`：4/4
  - seal 生成 transcript/digest、senders/errors；
  - 下一窗口 fromSeq = 前一 toSeq + 1，seq+1 active；
  - seal 后 cursor rewind（4→0、405→205），新 session 首轮带最近上下文；
  - tracker/queue/foreign/non-active 拒绝；
  - 405 条窗口截断保留最新 400 条。
- `f054-session-api.test.ts`：1/1（chain、CSRF、seal、detail、transcript、重复 seal）。
- daemon full：**574 passed / 5 skipped**。
- web：**27 files / 133 tests**；tsc + vite build passed。
- 隔离 3007/3016 + mock provider：seal 200；chain 显示 #0 sealed/hasArtifact +
  #1 active；摘要窗口 #1–#2、senders、tools、recent；Transcript 展开；
  390 `scrollWidth=390`，dialog 宽 358。
- 截图：`docs/design/F054/f054-session-chain-1440.png`、
  `f054-session-digest-1440.png`、`f054-session-transcript-1440.png`、
  `f054-session-chain-390.png`。

## 已知限制

- v1 同步 finalize，不写 `sealing` 中间态/异步 reaper；失败回滚保持 active。
  这是与 Clowder 的有意差异，避免 stuck sealing。
- 旧 lightweight sealed 行没有 artifact，链上显示「无制品」；窗口从 1 开始可能包含
  更早消息，后续可 backfill。
- 不做 restore/unseal；sealed 行只读。
- 不做自动阈值 seal/context health/compression/LLM handoff digest。
- transcript 是 thread 消息窗口（含该 agent 可见的上下文），不是 provider 原始
  JSONL；pi session 文件仍按 0010 保留，不删除。
- 连续性 v1 用 cursor rewind 到最近 200 条；digest 只做 UI/审计，不直接注入
  prompt。跨更多历史的 handoff/continuity capsule 仍留后续。

## 状态

- 实现、单测、隔离预览完成；等待非作者 review、CI、合入与 runtime 部署。

[宪宪/deepseek-flash🐾]
