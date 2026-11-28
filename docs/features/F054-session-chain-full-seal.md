---
feature_ids: [superagentteam/F054]
related_features: [superagentteam/F018, superagentteam/F028, superagentteam/F053]
title: "F054: Session chain & full seal — transcript/digest + chain panel"
status: implemented
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: []
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-28
updated: 2026-11-28
source_decision: "operator 2026-11-28: 当前有 session chain / session seal 吗？没有的话参考 Clowder 复用设计实现"
---

# F054: Session chain & full seal

## Why

SAT 的 `AgentSession` 目前是 **lightweight seal**（0010）：保留 `seq/status/
sealReason/sealedAt`，支持 active → sealed 与 seq+1 接续，但**没有**
transcript/digest、chain 读模型或 UI。operator 只能看到当前 active session，
看不到同一 thread×agent 的历史 session，也无法在封存时保留可回查的上下文。

Clowder 的对应设计：

- `SessionChainStore`：`(thread, cat)` 的 session 链，按 `seq` 排序；
- `SessionSealer`：`requestSeal`（active→sealing，清 active pointer）+
  `finalize`（transcript/digest + sealed）；
- `GET /api/threads/:threadId/sessions`、`POST /api/sessions/:sessionId/seal`；
- `SessionChainPanel`：链、状态、封存、摘要查看。

SAT 已有 durable `agent_sessions` 和 `seq/status` 形状；本 feature 补齐 chain 读模型、
手动 full seal、transcript/digest 制品与 Hub 面板。

## 用户结果

- 打开 thread 的 Sessions 面板，能看到每个 agent 的 session 链（seq、状态、
  messageCount、sealReason、封存时间）。
- active 且空闲的 session 可「封存」；封存后生成 transcript + 确定性 digest，
  并保留在链上可回查。
- 封存后下一次 invocation 自动创建 seq+1 active，旧 session 不删除。
- 有运行中/排队工作的 agent 不允许封存（typed 409），避免把工作封在旧 session。
- 封存不是静默丢历史：digest 摘要 + transcript 窗口可从 Hub/API 读取。

## 范围

### 后端

- `session_artifacts` 表（migration 008）：每个 sealed session 一条 transcript +
  digest 制品，含 `from_seq/to_seq/message_count/transcript_bytes`。
- `AgentSessionStore.listByThread(threadId, agentId?)`：chain 读模型。
- `SessionSealService`：
  - owner / active / idle 校验（tracker slot、queued/claimed target）；
  - 计算 transcript 窗口：上一封存 session 的 `to_seq + 1` 到当前 tail；
  - 捕获有界 transcript（默认最后 500 条，单条正文截断）；
  - 生成 extractive digest（senders、tools、errors、first/last/recent 摘要）；
  - 同一事务写 artifact + `active → sealed`；失败回滚保持 active；
  - 下一次 `ensureActive` 自动 seq+1。
- API：
  - `GET /api/threads/:threadId/sessions`；
  - `GET /api/sessions/:sessionId`（含 digest）；
  - `GET /api/sessions/:sessionId/transcript`；
  - `POST /api/sessions/:sessionId/seal`（CSRF + owner + idle）。

### Web

- Thread header 增加「Sessions」入口；`SessionChainDialog`：
  - 按 agent 分组列出 session 链；
  - active 行「封存」；sealed 行「摘要」/「Transcript」；
  - 封存确认与错误反馈；390/1440 光暗无横向滚动。

## 非目标

- 不做自动阈值 seal / context health / compression（Clowder F24 的自动段）。
- 不做 unseal/restore、跨 session restore UI（只做只读链 + seal）。
- 不做 LLM handoff digest；v1 是确定性 extractive digest。
- 不做 workspace 迁移、external import、scoped invocation、bg carrier。
- 不改 `AgentSession` 的 resume/lightweight seal 语义；F054 只补 full seal 制品。

## 验收标准

- [x] AC-1：`GET /api/threads/:threadId/sessions` 返回 owner 可见的完整链，
      按 agent + seq 排序；非 owner 403。
- [x] AC-2：active 且空闲的 session 可封存：artifact（transcript/digest）落库、
      session `sealed`、`sealReason/sealedAt` 正确；下一次 invocation 创建 seq+1。
- [x] AC-3：运行中或 queue 仍有该 agent 的 pending work → 409
      `session_busy`/`session_active_invocation`；非 active → 409；不产生 artifact。
- [x] AC-4：digest 确定性、transcript 窗口不重叠（fromSeq = 前一 sealed toSeq+1），
      超长窗口截断并标记；GET detail/transcript 可读。
- [x] AC-5：Hub Sessions 面板可列出链、封存 active、查看摘要/transcript；
      1440/390 无横向滚动；封存后 UI 刷新。
- [x] AC-6：daemon targeted/full、web tests/typecheck/build、doc-index 绿；
      隔离栈实机 seal + 链刷新证据。

## 实现

- migration 008 `session_artifacts`：immutable transcript + digest 制品。
- `SessionArtifactStore`、`AgentSessionStore.listByThread`、
  `MessageStore.getByThreadRangeRecent`。
- `domains/sessions/transcript.ts`：有界 transcript（400 条 / 3k 字符/条）+
  确定性 extractive digest（senders/tools/errors/first-last-recent）。
- `SessionSealService`：owner/active/idle 校验 → 窗口计算 → 同步事务
  （artifact + active→sealed + delivery cursor rewind 到
  `max(0, toSeq - 200)`）；失败回滚保持 active。
- API：`GET /threads/:id/sessions`、`GET /sessions/:id`、
  `GET /sessions/:id/transcript`、`POST /sessions/:id/seal`。
- Web：topbar `Sessions` → `SessionChainDialog`（链、封存、摘要、transcript）。

## 证据

- 报告：[`2026-11-28-f054-session-chain-full-seal.md`](../reports/2026-11-28-f054-session-chain-full-seal.md)
- 截图：`docs/design/F054/f054-session-chain-1440.png`、
  `f054-session-digest-1440.png`、`f054-session-transcript-1440.png`、
  `f054-session-chain-390.png`。
- daemon 574 passed / 5 skipped；web 27 files / 133 tests + tsc/vite build。
- 隔离 3007/3016 实机：seal 200 → chain #0 sealed/hasArtifact + #1 active；
  摘要/Transcript 可读；390 `scrollWidth=390`。
- 连续性：seal 后 cursor 回退到最近 200 条，新 session 首轮不空心启动
  （service test 断言 4→0 / 405→205）。

## 分阶段

| Phase | 内容 | 出口 |
|---|---|---|
| P1 | migration + listByThread + transcript/digest + seal service | 服务级测试绿 |
| P2 | routes + daemon API tests | chain/seal/read 契约绿 |
| P3 | Web Sessions dialog + tests | 操作面可用 |
| P4 | 隔离栈实机 + review + 部署 | 实机证据 + 非作者 review |

## 风险

- **封存竞态**：tracker slot 与 queue pending 检查后、写事务前可能有新工作进入；
  service 在同一事务前重新检查；封存后新工作落到 seq+1，不写旧 session。
- **窗口边界**：v1 以 artifact `to_seq` 接续；如果旧版本 lightweight sealed 行没有
  artifact，则从 1 开始，可能包含更早消息。文档标注并可在后续 backfill。
- **制品体积**：transcript 有界（500 条 / 单条截断 / 总字节上限），digest 只存摘要。
- **与 Clowder 差异**：v1 同步 finalize（无 sealing 中间态/异步 reaper），
  避免崩溃留下 stuck sealing；失败回滚保持 active。
- **首封窗口（P3-c）**：`fromSeq` 只看已有 `session_artifacts`；旧 lightweight
  sealed session 没有 artifact，第一次 full seal 的窗口从 1 开始，语义是
  thread-level transcript（最多 400 条截断），可能包含更早 session 的消息。
- **check→commit（P3-d）**：tracker/queue 检查、artifact 写入与 `sealActive` 在
  同一个同步 JS turn 内执行，事务内再次检查；SAT v1 不存在可观测交错。若未来
  改成异步 finalize，需要重新引入 guard。

## 证据

- 计划：`docs/plans/0054-session-chain-full-seal.md`
- 报告：`docs/reports/2026-11-28-f054-session-chain-full-seal.md`（执行时创建）
- 参考：Clowder `SessionChainStore`、`SessionSealer`、`SessionChainPanel`

[宪宪/deepseek-flash🐾]
