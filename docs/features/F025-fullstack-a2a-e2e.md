---
feature_ids: [superagentteam/F025]
related_features: [superagentteam/F018, superagentteam/F020, superagentteam/F024]
title: "F025: Full-stack A2A E2E — Hub agent management + real-provider chain"
status: review
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: [砚砚 (GLM 5.3 Flash), 墨墨 (Qwen 3.8 Flash)]
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-22
updated: 2026-11-22
source_decision: "operator 2026-11-22: 用前端 Hub 跑一次完整前后端 E2E（多 agent、同 thread A2A、multi-mention、跨 thread A2A），缺口优先补，/home/ming/.env 提供真实 provider key"
---

# F025: Full-stack A2A E2E — Hub agent management + real-provider chain

## Why

F018 已把 A2A runtime v1 做到 `done`（thread/invocation/queue/turn/worker/credential
+ 四工具），F020–F024 已把 thin Hub 的 thread/chat/unread/rename/retry 做完。但
operator 要的“完整前后端 E2E”仍缺三块：

1. **Hub 不能创建 agent**：`GET /api/agents` 只读，catalog 是 config-as-code；
   多 agent 测试只能手改 JSON + 重启 daemon。
2. **A2A 的可观察性不足**：消息 sender 用 raw agentId；跨线程消息的
   `extra.crossPost.sourceThreadId` 在 Hub 不显示；worker prompt 也不带
   cross-thread provenance，目标 agent 不知道源 thread，无法回帖。
3. **真实 provider 的完整链路没有从 Hub 跑过**：F018 live E1 已证明 daemon/CLI
   到真实 `kimi-coding` worker 的运行时闭环，但 Hub UI → 多 agent → 同/跨 thread
   A2A 仍只有 mock/seed 证据。

## 用户结果

operator 在 Hub 中：

- 创建多个 agent（id/displayName/mentionPatterns/account/model/role），无需手改
  JSON、无需重启 daemon；
- 新建 thread 1，发消息给 agentA，agentA 能按 prompt 用 A2A 工具转给 agentB，
  agentB 回复落回同一 thread；
- 跑一次 multi-mention（≥2 个 target + callback），看到 fan-out 与 aggregate；
- 新建 thread 2，跑几轮同 thread A2A；从 thread 1 跨帖到 thread 2，thread 2
  的 agent 回复，并能跨帖回 thread 1；Hub 能看出跨帖来源；
- 全程使用真实 provider（`kimi-coding` / `kimi-for-coding`），不是 mock。

## 范围

### P0（本 feature 必须）

1. **Agent management**：`GET /api/accounts`（无 secret）+ `POST /api/agents`
   （CSRF、catalog 校验、原子写、registry 热更新）；Hub Agents 面板新增 agent。
2. **Prompt roster**：worker prompt 列出 enabled agents（id/displayName/
   mentionPatterns），让 agent 能按 id 发起同/跨 thread A2A。
3. **Cross-thread provenance**：`buildThreadPrompt` 渲染
   `extra.crossPost.sourceThreadId`；Hub MessageList 显示“跨线程来自 …”并可跳转
   源 thread。
4. **Hub sender displayName**：消息 sender 用 agent displayName，fallback id。
5. **真实 provider E2E**：隔离 data dir + Kimi account/catalog；Hub 浏览器操作 +
   API/DB 证据；报告写入 `docs/reports/`。

### P1（可随后）

- Agent enable/disable/edit；删除 agent。
- Agent 在 prompt 中看到其他 thread 列表（当前跨帖目标 thread id 由 operator
  在消息里给出）。
- Tool-event / A2A 链可视化（当前以消息本身为证据）。

## 非目标

- Account/secret 管理 UI（`accounts.json` 仍 config-as-code；key 只从 env 读）。
- 新的 A2A 工具面（不增加 `list_threads` / `list_agents` 工具）。
- 自动跨 thread 回复路由（不做隐式回帖；由 agent 显式 `cross_post`）。
- F018 runtime 语义/day-1 schema 变更。

## 验收标准

- **AC1**：Hub 创建 3 个 agent（A/B/C）成功；`agent-catalog.json` 落盘；无需重启，
  `/api/agents` 与 Composer 立即出现；重复 id/mention、未知 account/model 有 typed
  错误且 catalog 不变。
- **AC2**：thread 1：operator → A → B → operator；消息 sender 显示 displayName；
  真实 provider 响应落库；A2A 消息在 thread 内可见。
- **AC3**：multi-mention：A 发问给 B+C，`callbackTo=A`；B/C 响应、aggregate、A 的
  后续消息都在 thread 可见；无 `multi_mention_cascade`/`loop_guard` 误伤。
- **AC4**：thread 2 内 ≥2 轮 A2A；thread 1 → thread 2 跨帖；thread 2 → thread 1
  回帖；Hub 跨帖来源 badge/链接正确。
- **AC5**：证据包含 UI 截图、message ids、invocation/attempt 状态、provider 响应；
  不记录任何 key。
- **AC6**：daemon targeted/full tests、web tests、typecheck/build、doc-index 全绿；
  非作者 review 覆盖最终 HEAD。

## 关键契约

- Agent create 只写 `agent-catalog.json`，绝不写 secret；account/model 必须已存在。
- Catalog 写入 = temp + fsync + atomic rename；校验失败不落盘。
- Registry 热更新必须保持同一 registry 对象身份（runtime/router/routes 已捕获），
  只替换内部 maps + revision。
- 跨帖 provenance 是消息 `extra` 的既有字段，不新增表/字段；UI/prompt 只读。
- 真实 provider key 只通过 env 注入子进程；报告/日志/截图不出现 key。
- E2E 使用隔离 data dir，不碰 `~/.superagentteam` 生产数据。

## 风险

- 模型不按 prompt 调 A2A 工具 → 用显式“必须调用 `superagentteam_post_message`”
  的测试 prompt；失败时记录 provider 输出与 toolEvents，不伪造。
- loop guard 对同 pair 连续路由 4 次 block → E2E 控制在 2–3 轮或用长回复/
  substantive 工具重置 streak；不绕过 guard。
- registry 热更新与并发请求 → 单进程内存替换；写入串行化；失败保留旧 registry。
- 真实 provider 限流/超时 → 记录 retry/失败；E2E 不把失败说成通过。

## 进展

- 2026-11-22：S1–S4 全部实现并通过真实 provider 全链路 E2E。
  - Hub 创建 3 个 agent（A/B/C），catalog 原子落盘、registry 同对象热更新，
    无需重启。
  - Thread 1：operator → A → B → A → operator；multi-mention B+C 的
    fan-out/aggregate/synthesis 全部可见。
  - Thread 2：两轮同 thread A2A；Thread 1 ↔ Thread 2 双向 cross-post；
    Hub 显示跨帖来源并可跳转。
  - 真实 provider：`kimi-coding` / `kimi-for-coding`；17 次成功调用，
    ~61.2k tokens（约 $0.021）。
- E2E 首轮暴露并修复 P1：`multi_mention.triggerType` / 嵌套 `target.kind`
  缺少 JSON Schema `type`，Kimi 400 拒绝整个 tool schema。已补 type +
  递归 schema 测试。
- 证据：`docs/reports/2026-11-22-f025-fullstack-e2e.md`、
  `docs/reports/2026-11-22-f025-e2e-evidence.json`、4 张截图。
- 剩余：非作者 review + merge；multi-mention 多次唤醒的 P3 噪音记入报告后续。

[宪宪/deepseek-flash🐾]
