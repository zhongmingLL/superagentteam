---
cell: identity-session + hub-action-surface
title: "复用卡：Account & Agent Settings 子面"
doc_kind: reuse-card
status: draft
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: []
created: 2026-11-24
updated: 2026-11-24
---

# 复用卡：Account & Agent Settings 子面

## 结论

| 项 | 值 |
|---|---|
| decision | **R1 适配复用** |
| priority | **P1-active** |
| 一句话 | 复用 Clowder 的 account 元数据/secret 分离、account 目录与 member editor 信息架构；运行时的 credential 解析按 SuperAgentTeam 的 pi worker 适配。 |

## Current truth

- SuperAgentTeam 已有 `AccountConfig { ref, provider, apiUrl?, apiKeyRef, models }` 和 `AgentConfig.accountRef`，但 `/api/accounts` 只读，`apiKeyRef`/`apiUrl` 未接入 worker；真实 E2E 依赖 ambient env。
- Agent 创建只有 `AgentPopover` 小表单；没有 account 管理 UI，也没有编辑入口。
- Clowder 的 account 页/agent editor 是参考实现，不是运行时依赖。

## 代码面

- Clowder：`packages/web/src/components/HubAccountsTab.tsx`、`AccountConnectionFields.tsx`、`components/members/MemberEditorPage.tsx`、`hub-cat-editor.sections.tsx`；`packages/shared/src/types/cat-breed.ts` 的 `AccountConfig`；`packages/api/src/routes/accounts.ts`。
- SuperAgentTeam：`packages/superagentteam-shared/src/types/message.ts`、`packages/superagentteam-daemon/src/domains/agent/*`、`packages/superagentteam-daemon/src/api/routes/agents.ts`、`packages/superagentteam-web/src/components/agent/AgentPopover.tsx`。

## codeteam mapping

- 复用 account 元数据 / secret 分离：accounts.json 只放 ref/provider/baseUrl/models/apiKeyRef；secret 放 credentials.json（0600）。
- 复用账户目录与表单信息架构（provider/models/baseUrl/key/绑定成员）；不复制 Clowder 的 OAuth/Codex/Claude 登录、quota、model alias。
- 复用 agent editor 的分区思路（模型与接入 / @ 名字 / 身份），但字段按 v1 AgentConfig 裁剪。
- 运行时适配：per-worker `PI_CODING_AGENT_DIR`，写 `auth.json` 与 `models.json`（baseUrl override），不把 secret 注入 daemon 全局 env。

## 风险与回滚

- **P1**：secret 落入 accounts.json / API 响应 / 日志。禁止；写测试与脱敏断言。
- **P2**：多个 account 共用一个 worker agent dir，key 串用。per-worker dir 隔离。
- **回滚**：account UI/API 是新增面；worker 可退回共享 dir + ambient env。
