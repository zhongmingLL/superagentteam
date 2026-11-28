---
title: "F037 execution plan — thread-first full-feature E2E"
doc_kind: plan
status: done
created: 2026-11-26
updated: 2026-11-28
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: []
feature: F037
related_features: [superagentteam/F018, superagentteam/F020, superagentteam/F025, superagentteam/F028, superagentteam/F030, superagentteam/F031, superagentteam/F034, superagentteam/F035, superagentteam/F036]
related: [features/F037-thread-first-e2e.md, architecture/0005-thread-first-runtime.md, architecture/0007-a2a-runtime-chain.md, runbooks/F033-local-runtime.md]
source_decision: "operator 2026-11-25/26: 先构造用例，再逐项执行，记录 bug，然后逐一修复"
---

# F037 execution plan

## 0. 基线与隔离

| 项 | 值 |
|---|---|
| 代码基线 | `origin/superagentteam-work` @ `ce0ad54db`（F030.5a merge record） |
| 工作分支 | `feat/f037-thread-first-e2e` |
| worktree | `/home/ming/agent/codeteam-f037` |
| test 端口 | web `3007` / daemon `3016` |
| test data | `/home/ming/.superagentteam-f037-e2e/data` |
| real-provider env | `/home/ming/.config/superagentteam/runtime.env`（只引用，不打印） |
| 禁止 | runtime `3005/3014`、`~/.superagentteam-runtime/data`、任何生产用户数据 |

启动/收尾使用 F033 的统一入口：

```bash
NODE_ENV=development npm install --ignore-scripts
NODE_ENV=development npm run build:offline
node packages/superagentteam-daemon/dist/cli.js \
  --data-dir /home/ming/.superagentteam-f037-e2e/data \
  runtime start --worktree /home/ming/agent/codeteam-f037 \
  --web-port 3007 --daemon-port 3016 \
  --env-file /home/ming/.config/superagentteam/runtime.env
```

## 1. 测试矩阵

> 本表是设计态矩阵；本轮执行结果、证据与 bug 处置以
> `docs/reports/2026-11-26-f037-thread-first-e2e.md` 为准。

> 层：B = 后端契约（API/DB/SSE）；H = Hub 浏览器操作；P = 真实 provider。
> 证据：T = automated test；C = command output；S = screenshot；D = DB/API dump。
> 状态：`todo` / `running` / `pass` / `fail` / `blocked` / `skip`。

### 1.1 基础与边界

| ID | 层 | 场景 | 预期 | 证据 | 状态 |
|---|---|---|---|---|---|
| F037-01 | B/H | 隔离栈启动、health、session、首次进入 | `runtime status` running；`/api/session` 200；无 legacy control.db | C/D/T | todo |
| F037-02 | B | projectPath 校验 + thread 创建/列表/空 thread | 相对/不存在/文件路径 422；合法目录 201；空 thread 不建 queue | T/D | todo |
| F037-03 | B | operator 消息 → agent 回复（mock provider） | InvocationRecord/TurnExecution/attempt/R 正确；无 task 写 | T/D | todo |
| F037-04 | B | v1 legacy 边界 | `a2a_send`/`handoff_*` 不存在；v1 不读 tasks/custody/review/merge | T/C | todo |
| F037-05 | B | thread access / 跨 user / deleted / CSRF | typed reject；不静默降级 | T | todo |

### 1.2 A2A 主链

| ID | 层 | 场景 | 预期 | 证据 | 状态 |
|---|---|---|---|---|---|
| F037-06 | B | 同 thread `post_message` A→B→A | 两次 invocation 按 queue 唤醒；回复落同一 thread | T/D | todo |
| F037-07 | B | `cross_post_message` thread1→thread2→thread1 | 目标 thread 收到并唤醒；source/target 归属正确 | T/D | todo |
| F037-08 | B | `multi_mention` 2–3 targets + callback | one source/queue/parent + N turns；aggregate/status 正确；callback child 正确 | T/D | todo |
| F037-09 | B | `thread_context` | 只读当前 thread 可见历史；跨 thread/跨 user 拒绝 | T | todo |
| F037-10 | B | mention 解析 | operator 正文 @ 路由；agent 正文 @ 不路由；未命中 pattern 不拒绝；disabled pattern 拒绝 | T | todo |
| F037-11 | B | queue cap/priority | user/A2A 分开 cap 5；urgent/FIFO；超限 429 `queue_full` 不写 source | T/D | todo |
| F037-12 | B | 幂等/replyTo/loop guard | message key replay；tool call replay/conflict；replyTo 非法拒绝；loop guard 生效 | T | todo |

### 1.3 运行控制与恢复

| ID | 层 | 场景 | 预期 | 证据 | 状态 |
|---|---|---|---|---|---|
| F037-13 | B | provider 连续失败 5 次 | 第 5 次后 `provider_retry_exhausted`；不再入队；用户可见说明 | T/D | todo |
| F037-14 | B | 手动 retry | 新 attempt；5 次预算重置；不复用终态 attempt | T/D | todo |
| F037-15 | B | 运行中 cancel | 202；turn/attempt/R canceled；worker 释放；queue 不 restore | T/D | todo |
| F037-16 | B | daemon restart/recovery | running/pending/callback 收敛；不重复 terminal | T/D | todo |
| F037-17 | B | SSE change/stream | thread-scoped；live 事件按 seq 去重；终态 durable message 覆盖 live | T | todo |

### 1.4 Hub 操作面

| ID | 层 | 场景 | 预期 | 证据 | 状态 |
|---|---|---|---|---|---|
| F037-18 | H | thread 创建、发送、消息时间线 | 202 receipt；消息出现；双击不双发；无 console error | S/C | todo |
| F037-19 | H | 未读 / 已读 / 跨 tab | 自己消息不计未读；打开清零；reload 保持；SSE 收敛 | S/T | todo |
| F037-20 | H | thread 重命名 | header/sidebar 同步；reload 保持；空标题拒绝 | S/T | todo |
| F037-21 | H | failed invocation retry | 仅 failed/interrupted 显示；成功提示；409 typed 文案 | S/T | todo |
| F037-22 | H | 运行中停止 | LivePill 显示停止；点击后状态 canceled；queue 说明可见 | S/T | todo |
| F037-23 | H | Agent 创建/编辑 | 无需重启；catalog 原子落盘；model 跟随 account；typed 错误 | S/D/T | todo |
| F037-24 | H | Account 创建/编辑/删除 | secret 不回显；绑定删除保护；provider/model 正确 | S/D/T | todo |
| F037-25 | H | Settings hub | 侧栏入口；accounts/agents 区块；390 可用；popover 不回归 | S/T | todo |
| F037-26 | H | execution record | thinking/tool 折叠；live 展开；终态收回；历史一致 | S/T | todo |
| F037-27 | H | rich block | agent 生成 card/checklist 落最终回复；刷新仍在；非法块 typed error | S/T | todo |
| F037-28 | H | 消息 surface | agent 气泡；operator 头像；A2A 收件人；跨 thread badge | S/T | todo |
| F037-29 | H | 1440/390 light/dark | 无横向滚动；composer 可用；键盘发送 | S | todo |
| F037-30 | H | relogin 深链接 | 401 → relogin → console-link → 回原 thread；恶意跳转拒绝 | S/T | todo |

### 1.5 真实 provider

| ID | 层 | 场景 | 预期 | 证据 | 状态 |
|---|---|---|---|---|---|
| F037-31 | P | 单 agent 回合 | 真实 Kimi 回复落库；account key 生效；日志无 key | C/D/S | todo |
| F037-32 | P | 同 thread A2A A→B→A | 两条 invocation 完成；B 回复在 thread 可见 | C/D | todo |
| F037-33 | P | 跨 thread A2A 双向 | thread1→thread2→thread1；provenance 正确 | C/D/S | todo |
| F037-34 | P | multi_mention B+C + callback A | fan-out/aggregate/callback 真实完成 | C/D/S | todo |
| F037-35 | P | 运行中停止 | provider 请求在飞时 cancel；turn/attempt canceled | C/D | todo |
| F037-36 | P | 重启后继续 | restart 后 thread/message 可见；新回合可执行 | C/D | todo |

## 2. 执行顺序

1. **P0**：安装/构建、baseline tests、创建 data dir、写入 test catalog/accounts、
   `runtime start` 3007/3016、确认 `/api/session`。
2. **P1**：新增/运行 deterministic E2E（真实 daemon + mock Anthropic provider），
   逐条填矩阵。优先主链 F037-01–17。
3. **P2**：隔离 Hub 浏览器操作，逐条填 F037-18–30；截图存
   `docs/design/F037/`。
4. **P3**：真实 provider 链路 F037-31–36；用独立 thread 前缀
   `F037-P-<scenario>`，记录 message/invocation/attempt id。
5. **P4**：按 bug 日志修复；每个修复先补失败用例（RED），再绿；回归受影响层。
6. **P5**：全量 tests + `npm run check`（必要时）+ 报告 + review。

## 3. Bug 日志格式

每条必须包含：

- `BUG-F037-xxx` / 标题 / 严重级别（P1/P2/P3）/ 层（B/H/P）
- 现象（操作、输入、实际结果）
- 复现（命令/URL/消息 id/数据 dir）
- 期望（引用 feature AC 或架构契约）
- 根因（代码路径/状态机/数据）
- 修复（commit SHA + 影响面）
- 回归（新增/更新的测试名 + 运行命令）
- 状态（open/fixed/verified/deferred）

## 4. 回归与门禁

- 后端修复：新增 `packages/superagentteam-daemon/test/f037-*.test.ts` 或补到对应
  feature 测试；跑 `npm test --workspace @superagentteam/daemon`。
- 前端修复：补 `packages/superagentteam-web/test/*.test.tsx`；跑
  `npm test --workspace @superagentteam/web` + `npm run typecheck --workspace @superagentteam/web`。
- 文档：`node scripts/check-doc-index.mjs`。
- 合入门禁：非作者 review 覆盖最终实质 HEAD；P1/P2 关闭；矩阵状态与报告一致。

## 5. 停止条件

- 隔离栈无法启动且根因在环境而非产品：记录 `blocked` + 缺口，不用 runtime 数据绕过。
- 真实 provider 不可用：保留 F037-31–36 `blocked` 证据，mock 层仍完成；不伪造真实链。
- 发现超出 F037 约定范围的新能力缺口：记 bug/P3 或另立 feature，不在本 feature 偷做。

## 6. 结项记录

- PR #211 landed `2db3f3b79135ea13bfd9692c06b31ab5af1c3c5a`（2026-11-26）。
- Reviewed HEAD `e7b27af5b`（实质代码 `93997c049`）；墨墨非作者 approve。
- CI 5/5；daemon 507 / web 109 / `npm run check` / doc index 47/37 绿。
- **2026-11-28 operator 验收通过**：F037 status `done`；最终 runtime `dceb0f86e`；
  BUG-F037-003/004/005 与 BUG-F051-001 修复并部署；web 120/120、daemon 561/5、
  CI 5/5。收口报告 `docs/reports/2026-11-28-f037-acceptance-close.md`。

[宪宪/deepseek-flash🐾]
