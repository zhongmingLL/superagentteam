---
title: "Reuse card thread-first revalidation — F018 v1"
doc_kind: report
status: draft-for-review
created: 2026-11-24
updated: 2026-11-24
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
related_features: [superagentteam/F018, superagentteam/F028, superagentteam/F031]
source_decision: "operator 2026-11-24: Reuse 卡 thread-first 重核；同时评估 task-first legacy 终局处置"
---

# Reuse card thread-first revalidation

## 0. 结论

2026-10-24 签的 P0 reuse 卡建立在 **task-first** 坐标上（Task / Run / Handoff /
`waits` / `custody_events`）。2026-11-04 operator 切到 **F018 thread-first v1** 后，
这些表在 greenfield schema 中不存在，只在 frozen legacy 里。故：

- **可直接沿用语义**：dispatch 的 single-ledger、delivery/terminal 分离；bubble 的
  message identity + dispatchRefs；identity/session 的 thread×agent；callback-auth 的
  child-TurnExecution capability；plugin 的 curated skill surface。
- **必须换坐标**：dispatch / identity-session / runtime-deployment 的存储与对象名从
  Task/Run 换成 Thread/Invocation/Turn/Attempt；bubble-pipeline 已在 2026-11-23 由
  F028 完成重核，本次只确认其 current 口径。
- **v1 明确不做，卡只能 deferred**：`ball-custody`、`managed-work`、`approval-index`、
  `sop-bulletin`、`harness-eval`。不要从这些卡直接写 v1 代码。
- **W8 前必须重核**：`github-signals` 仍写 `tasks` / `waits` / `forge_deliveries`，
  这三者在 F018 v1 中都没有；W8 不能按现卡直接实现。

## 1. 判定表

| Cell | 旧映射前提 | thread-first v1 verdict | 当前 v1 映射 / 动作 |
|---|---|---|---|
| `dispatch` | `queue_entries` + `runs.queue_entry_id` + `handoffs` | **adapt** | `invocation_queue` + `queue_admissions`（source/claim）；`invocation_records`（parent）；`invocation_attempts`（per-target attempt）；`turn_executions`（child）；投递事实在 input message 的 `lifecycle.dispatchRefs` / `extra.targetAgentIds`。 |
| `bubble-pipeline` | `runs` + `messages.dispatch_refs_json` + `rich_blocks_json` | **current（2026-11-23 已重核）** | `messages`（`seq`/`lifecycle_json`/`extra_json`）；response identity 在 `invocation_attempts.response_message_id`；terminal 在 `turn_executions.status` + T2 response lifecycle；富块在 `messages.extra.rich`（F031）。 |
| `identity-session` | `agent_profiles`/`roles` + task-bound session | **adapt** | `AgentConfig` + `AgentRegistry`（config-as-code）；`agent_sessions` 是 thread×agent；`thread_participants`；`agent_read_state`；无 taskId/stageId/role/effectiveToolPolicy。 |
| `callback-auth` | per-run token + task/role/run 坐标 | **current** | `invocation_credentials` 绑 child `TurnExecution`；`allowedTools`/`toolCallClaims`；token hash+salt；无 task/run。 |
| `runtime-deployment` | daemon identity/readiness + deployment wait on work Task | **adapt** | daemon identity/readiness 仍有效；v1 没有 deployment-wait / work Task，等待能力从 v1 卡中移除，后续如需要另立 feature。 |
| `plugin` | skill surface via manifest/allowlist | **current** | `packages/superagentteam-skills` curated catalog + pi explicit skill path；无 task-first 坐标。 |
| `ball-custody` | `handoffs` / `custody_events` / `waits` | **deferred** | F018 v1 明确不做 custody/handoff/wait；只有 post/cross/multi_mention。等 full A2A custody 重新立项再复用。 |
| `managed-work` | `Task`/`Run` + `work_admission`/`work_attempt` | **deferred** | F018 v1 不做 TaskItem/worktree/code delivery；Invocation/Attempt 身份归 `dispatch`，不归 managed-work。 |
| `approval-index` | `approvals` 表 + approval rich block | **deferred** | F018 v1 无 approvals 表；审批仍由 operator/human 流程承担；`approval` rich block 明确禁止（F031）。 |
| `sop-bulletin` | `backlog_items` / `workflow_sops` / `tasks.backlog_item_id` | **deferred** | v1 的 SOP/backlog 真相是 `BACKLOG.md` + `docs/SOP.md` + skills，不是 runtime 表；不要从本卡建第二套 backlog/SOP store。 |
| `harness-eval` | review/verdict/merge/eval 表 | **deferred** | F018 v1 不做 code delivery/review/merge/gate/eval；等 code delivery 能力重新立项再复用。 |
| `github-signals` | `tasks(kind=pr_tracking)` + `waits` + `forge_deliveries` | **preflight-required** | 三个落点都不存在；W8 必须先决定 thread-first 的 tracking subject、collector state、typed wait、delivery dedup，再写计划。 |

## 2. 逐卡要点

### dispatch

可复用：single pending-wake ledger（一个 source 一条 admission）、delivery 与 terminal
分离、per-target attempt、retry 复用 parent、queue cap/FIFO/urgent。

必须改：`queue_entries` → `invocation_queue`；`runs.queue_entry_id` →
`invocation_attempts`；`handoffs`/`inbox` 不再作为 source；`messages.dispatch_refs_json`
→ `messages.lifecycle_json.dispatchRefs`。`task DAG/priority/budget/worktree pool` 不属于
v1 admission，不能按旧卡接入。

### bubble-pipeline

可复用：一条 provider 事件只投影成一个可见 bubble；message identity、live/hydration
收敛、terminal 只由 canonical R 决定。

本卡已在 2026-11-23 由 F028 完成 thread-first 重核：当前 mapping 明确使用
`messages` + `response_drafts` + `turn_executions`，富块消费 `messages.extra.rich`；
`runs`/`dispatch_refs_json`/`rich_blocks_json` 只作历史。本次不再重复改卡，只把它
纳入 total verdict。

### identity-session

可复用：稳定身份 vs 执行身份分离；session chain/context continuity；review 独立性看
profile + session + modelFamily。

必须改：F018 v1 的稳定身份是 `AgentConfig`/`AgentRegistry`，不是 DB `agent_profiles`/
`roles`；执行身份是 `agent_sessions`（thread×agent），没有 taskId/stageId/role/
effectiveToolPolicy。`AgentProfile`/`roles` 只保留为历史概念。

### callback-auth

卡片在 2026-11-06 已按 F018 修订：credential 绑 child TurnExecution/thread/agent/session/
user，不绑 task/run；token 只存 hash+salt；liveness 用 child TurnExecution + worker +
tracker。**无需改实现映射**，只补 2026-11-24 重核记录。

### runtime-deployment

可复用：deployment identity、frozen build target、per-boot readiness、daemon ownership；
这是当前 daemon `/health` `/ready` 的基础。

必须改：旧卡把 deployment wait 挂到 work Task + F280 typed await；F018 v1 没有 Task/
waits，部署等待不在 v1。若未来 W8/CI 需要等待部署，另立 thread-first wait feature。

### plugin

可复用：curated skill allowlist + pi resourceLoader；`@superagentteam/skills` 当前实现
（F031 也通过这个 surface 注入 `rich-messaging`）。package admission/grants/marketplace
仍不做。

### deferred cells

`ball-custody`、`managed-work`、`approval-index`、`sop-bulletin`、`harness-eval` 的
**语义和风险清单仍有价值**，但它们是 task-first/code-delivery 时代的契约，不是 v1
实现契约。使用时必须重新立项，不能只改表名。

## 3. W8 / github-signals preflight

W8 卡仍写：

- `tasks.kind='pr_tracking'|'issue_tracking'` + `subject_key`；
- `waits.baseline_json/continuation_json/outcome_json`；
- `forge_deliveries`；
- `tasks.automation_state_json` 存 collector state。

F018 v1 没有这些表。W8 Phase A 必须先回答：

1. tracking subject 是 Thread、Invocation，还是新的 `forge_subjects` 表？
2. collector frontier/cursor 放哪里？是否允许新表，还是放进 thread metadata？
3. typed wait predicate 在 v1 没有 waits 的情况下如何建模？是否等 W8 自己引入
   `forge_waits`，还是复用 F167 hold（当前只有本地猫工具，不是外部 predicate）？
4. `forge_deliveries` 是否作为新的 thread-first 表保留？delivery dedup 与 webhook
   replay 的 owner 是谁？
5. 是否仍坚持“采集事实不直接投递/不直接唤醒”，由哪个 consumer 消费 matched delta？

在回答前，`github-signals` 卡只能作为历史输入，不能作为 W8 实现合同。

## 4. task-first legacy 终局处置建议

现状：

- `packages/superagentteam-daemon/src/legacy/task-first/` 约 88 个文件 / 800K；
- `docs/legacy/task-first/` 约 40K；
- `scripts/legacy-boundary-allowlist.json` 仍有大量 v1-adjacent 旧文件与 shim；
- 默认 A2A runtime 不使用 legacy，但 `--engine legacy` / legacy control-plane 入口仍在；
- legacy gate/SOP 测试仍直接 import legacy。

建议：**archive the reference, delete the runtime.** 不要让两套 runtime 长期并存。

分阶段：

1. **冻结与归档**：在删除前打 archive tag（例如 `archive/task-first-v1`），记录最后
   commit；把 `docs/legacy/task-first/` 标记为 non-normative archive。
2. **入口退场**：确认是否仍有数据/用户依赖 `--engine legacy` 或 legacy `control.db`；
   若有，先做只读导出/迁移说明；若无，移除 legacy CLI flags/commands 与 daemon
   legacy control-plane option。
3. **删除运行时**：删除 `src/legacy/task-first/`、依赖它的 v1 旁路 shim、legacy tests、
   allowlist 条目；保留 `docs/architecture/0006-task-first-legacy.md` 与一份最终删除报告。
4. **保留历史**：ADR/decision packet/feature 历史与最终 merge SHA 保留；删除后的 repo
   不再保留可执行 legacy 代码。
5. **防回流**：保留/加强 boundary guard，新增“legacy table/tool name 永不出现”的
   negative test；未来 code delivery 重新立项时按 thread-first 重写，不复制旧 runtime。

时机建议：

- 若当前没有活跃 legacy 用户/数据：**在 W8 前单独做一个 cleanup feature**，减少 W8
  期间的维护面与 token/测试成本。
- 若仍有 legacy 数据需要读：**先归档/冻结，W8 后按迁移窗口删除**；不要把 legacy
  数据迁进 v1，也不要在 W8 里顺手删除。
- 不建议“永久保留但继续跑测试”：这会持续支付维护、安全审计和误用成本。

## 5. 待 operator 决定

- legacy `--engine legacy` / `control.db` 是否仍有真实使用？决定 cleanup 在 W8 前还是后。
- deferred cells 是否允许在 v1 期间完全从开发路径移除（只保留历史卡），还是保留
  “将来重新立项”的入口说明。
- W8 的 tracking subject / wait / delivery dedup 存储选择，进入 W8 Phase A 设计包。

[宪宪/deepseek-flash🐾]
