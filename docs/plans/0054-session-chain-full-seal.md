---
title: "0054: Session chain & full seal implementation plan"
doc_kind: plan
status: active
created: 2026-11-28
updated: 2026-11-28
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
source_decision: "operator 2026-11-28: 当前有 session chain / session seal 吗？没有的话参考 Clowder 复用设计实现"
---

# 0054: Session chain & full seal plan

## 目标

在现有 `agent_sessions`（lightweight seal）上补 Clowder 的 chain + full seal 子集：

1. chain 读模型与 API；
2. 手动 seal：transcript + 确定性 extractive digest 落库；
3. Hub Sessions 面板；
4. 下一次 invocation 自动 seq+1（既有 ensureActive 已支持）。

## 现有契约

- `AgentSessionStore.ensureActive`：单 active、seq、workspace 校验。
- `AgentSessionStore.sealActive`：active→sealed，写 reason/sealedAt。
- `AgentSessionStore.createNextActive`：seq+1，已有。
- tracker slot：`tracker.has(threadId, agentId)` 判断运行中。
- queue：`listQueued/listActive` + targets 判断 pending work。
- messages：`getByThreadAfter/Befores/latestSeq`，可做 seq 窗口。

## 工作单元

### W1 — artifact schema + store

1. `008-session-artifacts.ts`：`session_artifacts` 表（PK session_id、thread/agent/seq、
   sealed_at/reason、digest_json、transcript_json、from_seq/to_seq、message_count、
   transcript_bytes）。
2. `SessionArtifactStore`：create/get/getBySession/chain lookup。
3. `AgentSessionStore.listByThread(threadId, agentId?)`。

### W2 — transcript + digest

1. `SessionTranscriptBuilder.build({messages, fromSeq, toSeq, agentId})`：
   - 有界条数（500）、单条正文截断（4k）、tool events 名称/状态；
   - 返回 `{transcript, messageCount, bytes, truncated}`。
2. `SessionDigestBuilder.build({session, transcript, window})`：
   - senders、tool usage、errors、first/last/recent excerpts；
   - `v:1`，确定性，无 LLM。
3. 单元测试：边界、截断、digest 稳定性。

### W3 — seal service + routes

1. `SessionSealService.seal(sessionId, userId, reason)`：
   - thread owner、status active、tracker/queue idle；
   - `fromSeq = max(previous artifact.to_seq) + 1`；`toSeq = messages.latestSeq`；
   - build transcript/digest；transaction：artifact + `sealActive`；
   - 返回 `{session, digest, transcriptMeta}`。
2. Routes：
   - `GET /api/threads/:threadId/sessions`；
   - `GET /api/sessions/:sessionId`；
   - `GET /api/sessions/:sessionId/transcript`；
   - `POST /api/sessions/:sessionId/seal`（CSRF）。
3. API tests：owner、non-owner、busy、non-active、seal + next seq、窗口不重叠。

### W4 — Web

1. `a2a`? 新 `domains/session/api.ts` + store? 保持简单：直接在 dialog 内 fetch/refresh。
2. `SessionChainDialog` + ThreadPage header「Sessions」按钮。
3. UI tests：链渲染、seal 调用、digest/transcript 查看、错误。
4. CSS：复用 `.st-dialog`，390 适配。

### W5 — 验证与收口

1. daemon targeted/full；web tests + typecheck/build；doc-index。
2. 隔离 3007/3016 实机：创建 session → 封存 → 链出现 sealed + seq+1 → 查看摘要。
3. 非作者 review、CI、合入、runtime 部署。

## 验证顺序

1. `npx vitest --run test/f054-*`
2. daemon full
3. web test + `check:web`
4. doc-index
5. 隔离栈截图

## 回滚

- 新增表 + service + routes + UI；回滚 code commit 即可。
- 不改变现有 lightweight seal/resume；旧 session 行/pi 文件保留。

[宪宪/deepseek-flash🐾]
