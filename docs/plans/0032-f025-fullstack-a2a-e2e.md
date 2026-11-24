---
title: "F025 — Hub agent management + full-stack A2A E2E"
doc_kind: plan
status: done
created: 2026-11-22
updated: 2026-11-22
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: [砚砚 (GLM 5.3 Flash), 墨墨 (Qwen 3.8 Flash)]
feature: F025
related_features: [superagentteam/F018, superagentteam/F020, superagentteam/F024]
source_decision: "operator 2026-11-22 full-stack E2E request"
---

# F025 — Hub agent management + full-stack A2A E2E

## 0. Gap matrix

| 缺口 | 当前 | 影响 | 处置 |
|---|---|---|---|
| Hub 创建 agent | `GET /api/agents` only | 多 agent 测试要手改 JSON/重启 | S1：accounts projection + `POST /api/agents` + UI |
| Registry 热更新 | 启动时 `loadRegistryFromFiles` | 新建 agent 后 runtime 不认 | S1：同对象 maps 替换 |
| Agent roster in prompt | prompt 只有 thread participants | A 不知道 B/C 的 id | S2：enabled agents roster |
| Cross-thread provenance in prompt | `extra.crossPost` 未渲染 | 目标 agent 不知道源 thread | S2：prompt 行前缀 |
| Cross-thread provenance in Hub | MessageList 不显示 `extra` | 无法从 UI 判断跨帖 | S3：badge + 源 thread 链接 |
| Sender displayName | 用 raw agentId | 多 agent 阅读困难 | S3：`agentLabel` 用于消息 |
| 真实 provider 全链路 | F018 live E1 只在 daemon/CLI | Hub 未验 | S4：隔离环境 + Kimi + Playwright |

## 1. S1 — Agent management (backend)

- `domains/agent/catalog-store.ts`：
  - `readCatalog(paths)` / `writeCatalogAtomic(paths, catalog)`
  - `createAgent(paths, input)` → validate candidate with `validateCatalog`，原子写
  - typed errors：`invalid_input`, `agent_exists`, `mention_pattern_conflict`,
    `account_not_found`, `model_not_in_account`, `catalog_write_failed`
- `registry.ts`：
  - `reloadRegistryFromFiles(registry, paths)`（或等价 handle）
  - 原地替换 `agents`/`mentionIndex`/`accounts`/`defaultAgentId`，revision +1
- `api/routes/agents.ts`：
  - `GET /api/accounts` → `{ accounts: [{ref, provider, models}] }`
  - `POST /api/agents` → CSRF + create + reload + 201 view
  - 从 daemon 传入 `catalogPath`/`accountsPath`
- tests：success、duplicate id/mention、unknown account/model、CSRF、atomic failure。

## 2. S2 — Prompt roster + cross-thread provenance

- `buildThreadPrompt` input：`knownAgents: readonly {id, displayName,
  mentionPatterns}[]`
- header 增加：
  ```text
  Available agents:
  - id=agentA displayName="Agent A" mentions=@agentA
  ...
  ```
- `renderSender`：当 `message.extra?.crossPost?.sourceThreadId` 存在时追加
  `(cross-thread from <sourceThreadId>)`。
- `RunAgentTurn` 从 registry 传 agents；补测试。

## 3. S3 — Hub A2A observability

- `AgentApi`：`accounts()`、`create(input)`；store actions。
- `AgentPopover`：create form（id/displayName/mentions/account/model/role），typed
  errors。
- `MessageList`：sender = `agentLabel(id)`；cross-post badge 链接到
  `/thread/<source>`。
- CSS for form/badge。
- web tests：store create、form submit、sender label、cross-post badge。

## 4. S4 — Real-provider E2E

Environment：

- isolated data dir `/tmp/superagentteam-e2e-<ts>/data`
- `accounts.json`：`[{ref:"kimi",provider:"kimi-coding",apiKeyRef:"KIMI_API_KEY",models:["kimi-for-coding"]}]`
- daemon env：`KIMI_API_KEY` 从 `/home/ming/.env` 读取（不写入磁盘/repo）
- `agent-catalog.json`：空 `{version:1,agents:[]}`；agents 全部通过 Hub 创建
- start daemon with A2A control plane + Hub origin；Vite dev server；console link。

Flow：

1. Login via console link；打开 Agents 面板；创建 A/B/C。
2. Create thread 1；发 operator→A prompt；A 响应；A→B via `post_message`；B 响应。
3. A `multi_mention` B+C；观察 fan-out + aggregate；A synthesis。
4. Create thread 2；A↔B intra-thread rounds（≤3）；thread 1 A `cross_post` 到
   thread 2 → C；C `cross_post` 回 thread 1 → A；A 响应。
5. Capture screenshots；query DB/API for message ids、invocation/attempt status、
   provider usage；write `docs/reports/2026-11-22-f025-fullstack-e2e.md`。

## 5. Verification

- daemon：`NODE_ENV=development npm test -w @superagentteam/daemon`
- web：`npm test -w @superagentteam/web`；`npm run typecheck -w @superagentteam/web`
- build：`NODE_ENV=development npm run build:offline`
- docs：`npm run check:doc-index`
- E2E：report + screenshots + DB evidence。

## 6. Results

- S1：`GET /api/accounts` + `POST /api/agents` + 原子 catalog 写 + registry
  热更新已落地；Hub Agents 面板可创建 agent。
- S2：worker prompt 增加 enabled-agent roster 与 cross-thread provenance；
  真实 provider 能按 id 发起同/跨 thread A2A。
- S3：Hub sender displayName、跨帖 badge/跳转、multi-mention 标记已落地。
- S4：真实 Kimi 全链路通过；证据见
  `docs/reports/2026-11-22-f025-fullstack-e2e.md`。
- P1 修复：v1 tool schema 的 `triggerType` / `kind` 补 `type`；新增递归
  schema 测试，防止其他 provider 同类拒绝。
- 2026-11-24：operator batch close（消息 `0001795523064349-000942-d9449e06`）；
  F025 feature 收口 → done。

[宪宪/deepseek-flash🐾]
