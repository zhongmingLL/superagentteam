---
title: "F030 execution plan — account & agent management"
doc_kind: plan
status: accepted
created: 2026-11-24
updated: 2026-11-24
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
related: [features/F030-account-agent-management.md, reuse/account-agent-settings.md, features/F025-fullstack-a2a-e2e.md, features/F029-message-surface-parity.md]
---

# F030 execution plan

## Goal

把临时 `.env` 凭据方案替换为 Hub 可管理的 account + agent 配置：账号元数据与 secret 分离，
agent 选择 account/model，worker 按 account 隔离 key 与 baseUrl。

## 切片

### F030.1 Account 契约 + 存储 + API

- `domains/account/providers.ts`：provider catalog（id/label/envName/supportsBaseUrl）。
- `domains/account/store.ts`：accounts.json + credentials.json 原子读写；ref/provider/models/baseUrl/secret 校验。
- `/api/providers`、`/api/accounts` CRUD；响应只含 `credential.kind`，不含 key。
- 单测：create/update/delete、secret 落盘位置、env ref、删除被绑定账号拒绝。

### F030.2 Account 设置 UI

- `AccountsModal`（从 Agents 面板进入）：列表 + 新增/编辑/删除。
- 表单：provider、models、baseUrl、API Key、env ref；错误可读。
- web API client 与 store；测试覆盖 secret 不回显/删除确认。

### F030.3 Agent 创建/编辑升级

- Agent 表单分区块：模型与接入、@ 名字、身份、角色说明。
- account 选择 + model 联动；显示 provider/credential 状态。
- 编辑现有 agent（catalog update API 若缺失则补）。

### F030.4 Worker 凭据隔离 + E2E

- spawn 输入携带 accountRef；每 worker 独立 `PI_CODING_AGENT_DIR`。
- 写 `auth.json`（api_key）与 `models.json`（baseUrl override）。
- 真实 provider E2E；缺失凭据 fail-closed；secret 扫描日志/DB/API。

## 测试矩阵

| 层 | 用例 |
|---|---|
| daemon store | create/update/delete、原子写、secret 不外泄、env ref、绑定检查 |
| api | providers/accounts CRUD、CSRF、删除冲突、响应脱敏 |
| web | account list/form/delete、agent account+model 联动、错误状态 |
| worker | per-worker dir、auth.json/models.json、凭据隔离、fail-closed |
| browser | 1440/390 光暗；创建 account → agent → 真实 turn |

## 回滚

- account store/API 与 UI 是新增面；回滚到 accounts.json 只读 + ambient env 即可。
- worker per-agent dir 可回退共享 dir；不迁移已有消息/thread。
