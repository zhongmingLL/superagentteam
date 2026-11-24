---
feature_ids: [superagentteam/F030]
related_features: [superagentteam/F018, superagentteam/F020, superagentteam/F025, superagentteam/F027, superagentteam/F029]
title: "F030: Account & agent management — credential contract, account settings, agent editor"
status: in-progress
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: []
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-24
updated: 2026-11-24
source_decision: "operator 2026-11-24: .env 是临时方案；正式方案参考 Clowder 的 account 配置页与 agent 创建页，两个需求合并做"
---

# F030: Account & agent management

## Why

F025 的真实 provider E2E 通过 `/home/ming/.env` 提供 key，是临时方案。正式产品需要：

1. **Account 配置**：Hub 里创建/编辑账号（provider、base URL、凭据、models），而不是手改 `accounts.json` / 环境变量。
2. **Agent 创建/编辑**：创建 agent 时选择 account + model，并补齐身份、@ 名字、角色说明等字段；现有 `AgentPopover` 小表单太简陋。
3. 两者合并：account 是 agent 的前置依赖，共用 provider/model/凭据校验，分开做会再次产生“页面有字段、运行时没接线”的半契约。

## Clowder 参考结论

- **Account 页**：`HubAccountsTab` 提供账号目录、搜索/筛选（OAuth / API Key）、新增/编辑/删除、绑定成员展示；`AccountConnectionFields` 提供 client、baseUrl、API Key、models tag editor + 推荐模型、高级 env vars。
- **Agent 编辑页**：`MemberEditorPage` 是分区页面（模型与接入 / @ 名字 / 身份 / 语音 / 上下文 / 高级），新建时有模板与头像选择；account 选项标注 OAuth / API Key / 内置，model 跟随 account 的 models 给建议。
- **数据模型**：`AccountConfig` 只存元数据（authType、clientId、baseUrl、models、envVars），secret 在独立 credentials store；agent 只持 `accountRef`。

## 用户结果

- Hub 里能看到账号列表、凭据状态（已存 / 环境变量 / 未配置）和绑定 agent。
- 新增/编辑账号：provider、models、可选 base URL、API Key（写入后不回显）；删除未被绑定的账号。
- 新建/编辑 agent：选择 account 后 model 联动，显示 provider/model；表单包含 id、显示名、@ patterns、角色说明等。
- 真实 provider 回合按 **account 的凭据与 base URL** 运行，不再依赖 daemon 的 ambient env；不同 account 可用不同 key。

## 范围

### F030.1 Account 契约 + 存储 + API

- Provider catalog（已知 provider id、默认 env、是否支持 baseUrl）。
- `accounts.json` 元数据 + `credentials.json`（0600，按 accountRef 存 API key）。
- `AccountConfig.apiKeyRef` v1：`secret:<ref>` 或 `ENV:<NAME>`；明文 key 不写 accounts.json。
- `GET/POST/PATCH/DELETE /api/accounts`；`GET /api/providers`；响应不含明文 secret。
- 删除被 agent 绑定的账号时拒绝，并返回绑定 agent 列表。

### F030.2 Account 设置 UI

- 账号目录：列表、搜索、凭据状态、绑定 agent、provider/model。
- 新增/编辑弹窗：provider、models、baseUrl（可选）、API Key（只写）、env ref；校验错误可读。
- 删除确认；无账号时给创建引导。

### F030.3 Agent 创建/编辑升级

- 从 `AgentPopover` 小表单升级为分区编辑界面：模型与接入（account + model）、@ 名字、身份、角色说明。
- account 选择展示 provider / 凭据状态；model 跟随 account。
- 支持创建与编辑（编辑 scope 以现有 catalog 字段为准）。

### F030.4 Worker 凭据隔离 + 真实 E2E

- 每个 worker 使用独立 `PI_CODING_AGENT_DIR`（`workerAgentDir/<workerId>`）。
- spawn 前按 accountRef 解析凭据，写 `auth.json`；有 `apiUrl` 时写 `models.json` 的 provider baseUrl override。
- 真实 Kimi/Z.AI 回合验证 account key/baseUrl 生效；日志/DB/API 无明文 key。

## 非目标

- OAuth / Codex / Claude 登录、quota、model alias、多 secret provider、云 KMS、key 轮换。
- Clowder 的完整 member editor（语音、上下文、高级运行时参数、模板/头像全套）。
- 账号级并发/配额策略。

## 验收标准

- [ ] 账号可在 Hub 创建/编辑/删除；secret 不回显、不写 accounts.json、不进日志。
- [ ] agent 创建/编辑可选 account 与 model，provider/model 显示正确。
- [ ] 新建 account 后无需改 `.env` 或重启 daemon 即可用于新 agent 回合。
- [ ] 不同 account 的 key/baseUrl 在各自 worker 生效，互不串用。
- [ ] 真实 provider E2E：account → agent → turn 成功；缺失/错误凭据 fail-closed。
- [ ] web/daemon tests、typecheck、build、doc-index 全绿；1440/390 截图。

## 风险与回滚

- **凭据边界**：secret 只进 credentials.json（0600）与 worker 的 auth.json；API 响应、日志、错误信息都不含明文。回滚只影响账号/凭据读取，不改消息真相。
- **Provider 兼容**：v1 只支持 provider catalog 内的 API-key provider；未知 provider 在创建时拒绝。
- **Worker 隔离**：per-worker agent dir 是新增目录；回滚可退回共享 dir + ambient env（旧行为）。
