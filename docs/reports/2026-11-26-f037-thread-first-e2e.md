---
title: "F037 thread-first full-feature E2E — execution report"
doc_kind: report
status: implemented
created: 2026-11-26
updated: 2026-11-26
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
feature: F037
related_features: [superagentteam/F018, superagentteam/F020, superagentteam/F025, superagentteam/F028, superagentteam/F030, superagentteam/F031, superagentteam/F034, superagentteam/F035, superagentteam/F036]
source_decision: "operator 2026-11-25/26: thread-first 当前实现的所有大特性做前后端 E2E；先用例，再逐项执行，记 bug，逐一修复"
---

# F037 thread-first full-feature E2E

## 结论

thread-first 当前实现的主链在隔离栈里跑通：真实 Hub 操作、真实 Kimi provider、
同 thread A2A、跨 thread 双向 A2A、multi_mention + callback、取消、重启动恢复、
execution record、rich block、账号/Agent 热更新、未读/重命名/重试均得到实际证据。

本轮发现并修复 1 个 P2 前端缺口（移动端 Settings 入口/返回）；1 个 P3 prompt
可读性问题明确挂账。未发现 A2A 状态机、队列、取消、恢复或数据边界的 P1/P2 缺陷。

**收口**：PR #211 landed `2db3f3b79135ea13bfd9692c06b31ab5af1c3c5a`（2026-11-26）；
reviewed HEAD `e7b27af5b`；墨墨非作者 approve；GitHub CI 5/5 绿。F037 进入
`superagentteam-work`，operator 验收与正式栈签收项仍独立。

## 隔离与基线

| 项 | 值 |
|---|---|
| 代码基线 | `origin/superagentteam-work` @ `ce0ad54db` |
| 工作分支 | `feat/f037-thread-first-e2e` |
| worktree | `/home/ming/agent/codeteam-f037` |
| test 栈 | web `3007` / daemon `3016` |
| test data | `/home/ming/.superagentteam-f037-e2e/data` |
| 真实 provider | Kimi `kimi-coding` / `kimi-for-coding`（key 只经 env 文件注入，未打印） |
| 正式栈边界 | 未写入正式入口/数据；只读取 accounts/catalog 确认 provider 配置，未读取/使用正式消息或会话数据；本轮只使用隔离 test 栈 |

## 验证命令

| 命令 | 结果 |
|---|---|
| `NODE_ENV=development npm test --workspace @superagentteam/daemon` | 507 passed / 1 skipped（76 files） |
| `NODE_ENV=development npm test --workspace @superagentteam/web` | 109 passed（25 files） |
| `npm run typecheck --workspace @superagentteam/web` | pass |
| `npm run build --workspace @superagentteam/web` | pass |
| `node scripts/check-doc-index.mjs` | 47 feature docs / 37 BACKLOG rows |
| 隔离栈状态检查（write-path smoke） | running + ok |

## 执行矩阵

> `pass` = 本轮实际执行；`pass (auto)` = 由全量 daemon/web 测试覆盖，且本轮套件通过。
> 证据列：`UI` 截图见 `docs/design/F037/`，`DB` 为隔离 `f018.db` 查询，`SSE` 为
> `/api/events` 实际流。

| ID | 场景 | 结果 | 证据 |
|---|---|---|---|
| F037-01 | 隔离栈启动、health、session、首次进入 | pass | 状态检查 ok；隔离端口；`/api/session` 200 |
| F037-02 | projectPath 校验 + thread 创建/列表/空 thread | pass (auto) | `api-threads.test.ts` / `api-static.test.ts`；本轮全量套件 |
| F037-03 | operator 消息 → agent 回复 | pass | 真实 Kimi `F037_HUB_OK`；`invocation_records` completed；`turn_executions` completed |
| F037-04 | v1 legacy 边界 | pass | `f018.db` legacy tables = 0；`E13/E14` 套件 |
| F037-05 | thread access / 跨 user / deleted / CSRF | pass (auto) | `api-threads.test.ts` / `api-messages.test.ts` / `api-session.test.ts` |
| F037-06 | 同 thread `post_message` A→B→A | pass | 真实 A2A：A 调 `post_message`，B 回复；`f037-fullstack-e2e.test.ts` mock 全链 |
| F037-07 | `cross_post_message` thread1→thread2→thread1 | pass | `CROSS_FROM_THREAD1` + `CROSS_ACK_FROM_THREAD2`；Hub 跨线程来源 badge |
| F037-08 | `multi_mention` 2–3 targets + callback | pass | B/C 回答 `MULTI_B_OK`/`MULTI_C_OK`；aggregate + callback A |
| F037-09 | `thread_context` | pass | B 的 toolEvents 含 `superagentteam_thread_context`；跨 thread/负例套件 |
| F037-10 | mention 解析 | pass (auto) | `f018-agent-registry-mentions.test.ts` / `f018-r4-d-observation.test.ts` |
| F037-11 | queue cap/priority | pass (auto) | `f018-queue-ledger.test.ts` / `f018-r2a-dispatch.test.ts` / `api-queue-live.test.ts` |
| F037-12 | 幂等/replyTo/loop guard | pass (auto) | `f018-r3-a-post-cross-post.test.ts` / `f018-r4-loop-guard.test.ts` / `f018-r5-a-tool-bridge.test.ts` |
| F037-13 | provider 连续失败预算 | pass (auto) | `f018-r2a-dispatch.test.ts`；真实 401 按不可重试 provider_error 终态 |
| F037-14 | 手动 retry | pass | 失败回复点击“重试” → “已重新排队”；新 attempt/失败气泡 |
| F037-15 | 运行中 cancel | pass | 点击“停止” → `已取消`；DB parent/turn/attempt `canceled/operator_canceled` |
| F037-16 | daemon 重启动/recovery | pass | 重启动后 0 running；历史 25 messages / 11 invocations 保留 |
| F037-17 | SSE change/stream | pass | curl `/api/events` 收到 3 个 change + text/done stream |
| F037-18 | thread 创建、发送、消息时间线 | pass | Hub 创建 `F037 Hub E2E`；消息/回复/思考记录可见 |
| F037-19 | 未读 / 已读 / reload | pass | 后台回复后 unread=1；打开清零；reload 仍 0 |
| F037-20 | thread 重命名 | pass | header/sidebar 同步；reload 保留；`titleSource=user`；空标题禁用保存 |
| F037-21 | failed invocation retry | pass | 401 失败气泡显示“重试”；点击后“已重新排队” |
| F037-22 | 运行中停止 | pass | LivePill “停止”；点击后 live 清空、消息“已取消” |
| F037-23 | Agent 创建/编辑 | pass | Settings 创建 Agent D；catalog 落盘；无需重启动；编辑 account/model 联动 |
| F037-24 | Account 创建/编辑/删除 | pass | 创建 OpenAI 测试账号；secret 不回显；`accounts.json` 无 key；`credentials.json` 0600；绑定删除 409 可读 |
| F037-25 | Settings hub | pass | 侧栏入口、accounts/agents 区块、390 可用；**发现并修复移动端入口/返回缺口** |
| F037-26 | execution record | pass | 历史 thinking/tool 折叠；展开显示 tool name/args/result |
| F037-27 | rich block | pass | Agent A 调 `create_rich_block`；Hub 渲染 “F037 Rich Card”；DB `extra.rich.blocks[0].id=f037-card` |
| F037-28 | 消息 surface | pass | agent 气泡、operator 头像、A2A “发送给”、跨 thread badge |
| F037-29 | 1440/390 light/dark | pass | 截图 5 张；390 `scrollWidth=390`；侧栏抽屉可开合 |
| F037-30 | relogin 深链接 | pass (auto) | `relogin-page.test.tsx` / `return-to.test.ts`；本地 dev auto-login 不产生 401，未强制造 401 |
| F037-31 | 单 agent 真实回合 | pass | `F037_HUB_OK`；Kimi provider；message/invocation/attempt 已落库 |
| F037-32 | 同 thread A2A | pass | `A2A_FROM_A` + B 回复；A toolEvents `post_message` |
| F037-33 | 跨 thread A2A 双向 | pass | thread1 ↔ thread2 两条跨帖；Hub provenance |
| F037-34 | multi_mention B+C + callback A | pass | 两个 target 回复 + aggregate + callback A |
| F037-35 | 运行中停止（真实 provider） | pass | provider 在飞时停止；canceled 终态 |
| F037-36 | 重启动后继续 | pass | 重启动后 `RESTART_OK` 新回合完成 |

## Post-F044 revalidation（2026-11-27）

背景：F044a（route/T2 ownership）与 F044b（Phase B → `invoke-single-agent`）改动了
同一条执行链；按 operator 2026-11-27 的强制 E2E 要求，用当前 worktree 对 F037
矩阵做一次架构后复验。

**隔离与坐标**

| 项 | 值 |
|---|---|
| 代码基线 | `origin/superagentteam-work` @ `889a495bd`（含 PR #245 F044b、PR #246 AC-6 matrix） |
| worktree | `/home/ming/agent/codeteam-f037` |
| test runtime | fullstack E2E 在测试内 `mkdtemp` 数据目录 + ephemeral port；daemon/web 测试同样每用例独立临时目录 |
| 正式栈边界 | 未读写 runtime 3005/3014、`~/.superagentteam-runtime/data` |
| 真实 provider | 本机 `OPENROUTER_API_KEY` 存在但不是有效 OpenRouter key（401）；未打印 key |

**Fresh commands**

| 命令 | 结果 |
|---|---|
| `NODE_ENV=development npm test --workspace=@superagentteam/daemon` | **537 passed / 1 skipped**（79 files） |
| `NODE_ENV=development npx vitest run packages/superagentteam-daemon/test/f037-fullstack-e2e.test.ts` | **2 passed**（真实 daemon + 真实 pi worker + mock provider） |
| `NODE_ENV=development npm test --workspace=@superagentteam/web` | **120 passed**（25 files） |
| `npm run typecheck --workspace=@superagentteam/web` | pass |
| `npm run check:doc-index` | 61 feature docs / 51 BACKLOG rows |

**矩阵复验**

| 行 | 结果 | 证据 |
|---|---|---|
| F037-01–17（后端 A2A） | pass | daemon full suite 537/1；其中 `f018-r2a/b/c/d`、`f018-r3-*`、`f018-r4-d2`、`f018-r5-*`、`api-*` 覆盖发送/执行/A2A/队列/取消/重试/恢复/SSE；fullstack E2E 覆盖 F037-03/06；F043 AC-1 barrier 在 multi-target 用例中复验 |
| F037-18–30（Hub 操作面） | pass（前端未改，web 套件当前） | web 120/120 + typecheck；F044a/b 只改 daemon 执行链，未改前端消息表面；2026-11-26 的 16 张截图仍是视觉证据，本轮**未重新截图**（明确不声称 fresh visual run） |
| F037-31–36（真实 provider） | **未成功复跑**（环境 key 无效） | OpenRouter 401 原文：`this is not an OpenRouter API key`；2026-11-26 Kimi 证据仍有效但不在本 HEAD。负面运行证明真实 worker + provider 失败路径正确：parent/attempt/turn/R 均 failed、无 `delivery_failure`、worker retired。成功路径在 889a495bd 未验证，不写成 pass |

**Bug Log（本轮）**

- 未发现新的产品缺陷。
- F044b 自查发现并修复了一条跨分支回归：provider 失败后的 bounded backoff 被
  Phase B 成功路径的 `deferrals.reset` 清掉（热 retry）。修复 `0062a35ae` / PR #245；
  回归用例在 `f044b-phase-b-ownership.test.ts`。这是 F044b 的修复，不记作新 F037 bug。

**边界**

- F037-31–36 的成功路径本轮没有 fresh 证据；不把 2026-11-26 的 Kimi 结果外推到
  `889a495bd`。需要有效 provider key 时再补一次。
- Operator 验收仍是 F037 的唯一未闭合外部门槛；F034/F035/F036 的正式栈签收项不变。

## Bug Log

### BUG-F037-001（P2，Hub）— 移动端没有 Settings 入口，进入设置后无法返回

- **现象**：390px 下 nav rail 隐藏；thread sidebar 的移动导航只有 Threads/Tasks/Memory，
  没有 Settings；直接访问 `/settings` 后页面也没有返回对话入口。用户只能依赖浏览器后退。
- **复现**：390×844 → 打开 thread sidebar → 无“设置”；打开 `/settings` → 无“返回对话”。
- **期望**：F035 AC-1 “侧边栏底部设置入口可见、可键盘访问、窄屏可用”；设置页应可返回。
- **根因**：`NavRail` 在 `max-width: 900px` 被隐藏；`ThreadSidebar` 移动导航未包含 Settings；
  `AppShell` 在 settings 路由隐藏 topbar/sidebar，`SettingsPage` 又没有返回链接。
- **修复**：移动导航新增 Settings Link；Settings 页新增 mobile-only “← 返回对话”；
  `st-settings-back` 桌面隐藏、≤900px 显示。
- **修复 commit**：`93997c049`（与 F037 文档/全栈测试同一提交）。
- **回归**：`thread-sidebar.test.tsx` 新增移动 Settings 入口断言；`settings-page.test.tsx`
  新增返回链接断言；390 实机复验 + 截图。
- **状态**：fixed / verified（web 109 tests + typecheck/build）。

### BUG-F037-002（P3，Prompt）— A2A body 只有标签时，收件 agent 可能回“没有请求”

- **现象**：A 用 `post_message` 发送 `bodyMd: "A2A_FROM_A"`；B 被正确唤醒并回复，但正文说
  “No request has been directed at me yet”，没有把该 A2A 消息当作请求。
- **复现**：真实 Kimi 同 thread A2A，body 只有标签、没有明确问题。
- **期望**：收件 agent 应把“唤醒它的最新 A2A 消息”当作当前请求，至少不否认收到请求。
- **根因**：`buildThreadPrompt` 只渲染 “Recent messages” 窗口，没有显式 “当前请求/被唤醒原因”
  标记；当 body 是裸标签时，模型可能把它当上下文。显式问题的 `multi_mention` 路径
  （B/C 都正确回答）证明 A2A 路由/状态机本身正常。
- **处置**：P3 deferred。建议后续在 prompt 增加 current-request 标记（F018 prompt 语义
  follow-up），不在 F037 内改 A2A prompt 契约。
- **回归**：暂无（行为依赖模型；发送方应在 `bodyMd` 写明请求）。

## 观察与边界

- 真实 provider 的 401 是 non-retryable，直接 failed 并显示“重试”，符合 F034 的失败分类；
  5 次自动重试预算由 provider 可重试失败路径覆盖（全量套件）。
- 隔离栈使用 Kimi key；报告/截图/DB 查询不包含 key。`accounts.json` 只含 `apiKeyRef`。
- 本地 dev auto-login 让 401/relogin 深链接无法在隔离栈自然触发；由 web/daemon 负例测试覆盖。
- F034 AC-5、F035 AC-5 的“正式栈实机”仍是 operator 签收项；本轮只在隔离栈验证，
  不把 live 写成已验收。F036 的 operator close 同样保持原状态。

## 证据文件

- 截图：`docs/design/F037/`（16 张；含 1440/390 light/dark、A2A、multi_mention、rich block、
  settings、mobile nav、停止按钮）
- 详细测试报告（29 个用例 + 16 张截图）：`docs/reports/2026-11-26-f037-thread-first-e2e-detailed.md`。
- 自动化：`packages/superagentteam-daemon/test/f037-fullstack-e2e.test.ts`
- 前后端修复测试：`packages/superagentteam-web/test/settings-page.test.tsx` /
  `thread-sidebar.test.tsx`
- 隔离数据：`/home/ming/.superagentteam-f037-e2e/data/f018.db`（测试数据，未入库）

[宪宪/deepseek-flash🐾]
