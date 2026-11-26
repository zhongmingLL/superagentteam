---
feature_ids: [superagentteam/F037]
related_features: [superagentteam/F018, superagentteam/F020, superagentteam/F025, superagentteam/F028, superagentteam/F030, superagentteam/F031, superagentteam/F034, superagentteam/F035, superagentteam/F036]
title: "F037: Thread-first full-feature E2E"
status: implemented
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: []
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-26
updated: 2026-11-26
source_decision: "operator 2026-11-25/26: thread-first 当前实现的所有大特性（A2A 等）做前后端端到端测试；先构造用例，再逐项执行，记录 bug，然后逐一修复"
---

# F037: Thread-first full-feature E2E

## Why

F018 把 A2A runtime v1 做成了单一执行真相（Thread / InvocationRecord /
TurnExecution / attempt / durable stream），F020–F036 又在它上面长出了 Hub、账号与
Agent 管理、执行记录、富块、停止/重试、Settings、视觉与启动隔离。当前验证证据分散在
各 feature 的 targeted test、一次性隔离栈 E2E 和 live smoke 中：

- 没有一份从 **真实 Hub 操作面 + 真实 provider** 出发、覆盖 thread-first 主要能力的
  统一 E2E 矩阵；
- 部分 feature 的 operator 验收仍未完成（F034 AC-5 live 停止点击、F035 AC-5
  3005 实机创建、F036 operator close）；
- 回归只覆盖各 feature 自己的局部行为，缺少“同一条链上前后端 + DB + SSE 同时成立”的
  证据；
- 真实 provider 的 A2A 链路只在 F025 跑过一次，之后 F028/F030/F031/F034 的新契约
  没有再合流验证。

本 feature 不新增产品能力，目标是把 thread-first 当前实现当作一个整体，在隔离环境里
按用例逐项跑通，暴露真实 bug，修复并留下可重复的回归证据。

## 用户结果

- operator 拿到一份可回查的 F037 E2E 矩阵，覆盖后端 A2A 契约、Hub 操作面、真实
  provider 链路三层。
- 每一项都有实际执行记录：命令/入口、数据坐标、状态、截图或 DB/API 证据；失败项不是
  “跳过”，而是进入 bug 日志。
- 所有 P1/P2 bug 在当前分支修复并有回归用例；P3 明确挂账，不用一句“已知问题”模糊处理。
- 验收在一个全新的隔离栈完成：独立 worktree、3007/3016、独立 data dir，不读写
  runtime 3005/3014 和 `~/.superagentteam-runtime/data`。
- 最终交付包含 F037 文档、执行计划、E2E 报告、bug 日志和回归测试；CI 绿。

## 范围

### 1. 后端 A2A 契约

- Thread / message / queue / invocation / turn / attempt / credential 的 v1 真相与
  状态机；无 task/custody/code-delivery 依赖。
- `post_message` / `cross_post_message` / `multi_mention` / `thread_context` 四条
  模型面工具；mention 解析、loop guard、replyTo、幂等、负例。
- queue cap/priority、retry 预算、cancel、restart/recovery、SSE change/stream。
- 账号/Agent catalog 热更新、worker 凭据隔离、rich block producer。

### 2. Hub 操作面

- 首次进入 / session / console-link / relogin；thread 创建、列表、发送、未读、
  重命名、重试、停止、跨 thread 来源。
- Agent / account 创建编辑、Settings 入口、execution record、rich block、A2A
  收件人归属、operator 头像与气泡。
- 1440/390、light/dark、键盘发送与无横向滚动。

### 3. 真实 provider 链路

- 隔离栈 + 真实 Kimi account：单 agent 回合、同 thread A2A、跨 thread A2A、
  multi_mention + callback、运行中停止。
- 全程不记录 key；失败/限流时保留真实证据，不把失败写成通过。

## 非目标

- 不新增 A2A 工具、thread 能力或产品交互；发现缺口时先记 bug，修复以恢复约定行为为限。
- 不恢复 task-first legacy（tasks/custody/code delivery/review/merge）。
- 不操作 runtime 3005/3014、`~/.superagentteam-runtime/data` 或任何生产用户数据。
- 不做生产部署、Windows 代理或跨机编排。
- 不把 F037 变成新的 A2A 契约来源；契约仍以 0005/0007 与各 feature 文档为准。

## 验收标准

- [x] AC-1：F037 矩阵覆盖后端 A2A 契约、Hub 操作面、真实 provider 三层；每行有
      预期结果、证据类型和执行状态。
- [x] AC-2：隔离 daemon + mock provider 的确定性 E2E 跑通 thread-first 主链
      （发送 → 执行 → 回复 → A2A → 跨 thread → multi_mention → 队列/取消/重试），
      并断言 v1 DB 真相、无 legacy 表读写。
- [x] AC-3：隔离 Hub 浏览器 E2E 跑通首次进入、thread、agent/account 创建、Settings、
      未读/重命名、execution record、rich block、A2A 归属、停止/重试；1440/390
      light/dark 截图。
- [x] AC-4：真实 Kimi provider 在隔离栈完成单 agent、同 thread A2A、跨 thread A2A、
      multi_mention + callback；日志/报告不含 key。
- [x] AC-5：每个 bug 记录现象/复现/期望/根因/修复 commit/回归用例；P1/P2 全部修复，
      P3 明确挂账。
- [x] AC-6：daemon/web targeted + full tests、typecheck/build、doc-index 绿；非作者
      review 覆盖最终实质 HEAD。
- [x] AC-7：F037 feature/plan/BACKLOG/docs index/report 与真实交付一致，不把
      “已实现”写成“已验收”。

## 分阶段

| Phase | 内容 | 出口 |
|---|---|---|
| P0 | 立项 + 基线 + 隔离 worktree/栈 + 矩阵 | F037 docs + BACKLOG；baseline tests 绿；矩阵可执行 |
| P1 | 后端 A2A 确定性 E2E（mock provider + 真实 daemon API） | 主链用例执行完；bug 日志建立 |
| P2 | Hub 浏览器 E2E（隔离 3007/3016） | 操作面用例 + 截图；前后端 bug 记录 |
| P3 | 真实 provider 链路 E2E | 真实回合/A2A/multi_mention/停止证据 |
| P4 | bug 修复 + 回归 | P1/P2 修复；回归测试绿 |
| P5 | 报告 + 全量验证 + review/收口 | 报告、CI、review verdict；operator 验收输入 |

## 风险

- **真实 provider 不稳定**：限流、超时、模型不按 prompt 调工具。保留失败输出与 attempt
  状态；不伪造成功；必要时降级为 mock 证据并明确标注。
- **浏览器自动化不可重复**：仓库没有 Playwright 依赖。P2 先使用隔离栈 + Hub 真机操作
  和截图；需要回归的确定性断言落到 web/daemon 测试，不把截图当自动回归。
- **测试数据污染**：任何命令之前先确认 data dir/端口；绝不使用 runtime 数据。
- **范围膨胀**：F037 只修 E2E 暴露的约定内 bug；新能力另立 feature。
- **测试掩盖真实链路**：mock provider 只证明控制面/状态机，不替代真实 provider；
  两层都要有独立证据。

## 证据

- 计划与矩阵：`docs/plans/0046-f037-thread-first-e2e.md`
- 执行报告：`docs/reports/2026-11-26-f037-thread-first-e2e.md`（执行时创建）
- Bug 日志：同上 §Bug Log
- 隔离坐标：`/home/ming/agent/codeteam-f037`，test `3007/3016`，
  data `/home/ming/.superagentteam-f037-e2e/data`

## 进展（2026-11-26）

- 隔离栈真实 Kimi E2E 跑通：单 agent、同 thread A2A、跨 thread 双向、multi_mention +
  callback、运行中取消、重启动恢复、rich block、账号/Agent 创建编辑、未读/重命名/重试。
- 新增确定性全栈测试 `f037-fullstack-e2e.test.ts`：真实 daemon + 真实 pi worker +
  mock provider，A→B `post_message` 两段 invocation 完成；daemon 507 passed。
- 发现并修复 BUG-F037-001（P2）：≤900px 没有 Settings 入口、进入设置后无法返回；
  移动导航与 Settings 返回链接已补，修复 commit `93997c049`；web 109 tests +
  typecheck/build 绿。
- BUG-F037-002（P3）：A2A body 只有标签时收件 agent 可能回“没有请求”；prompt
  current-request 标记列为 F018 prompt 语义 follow-up，不在 F037 改契约。
- 执行记录与矩阵：`docs/reports/2026-11-26-f037-thread-first-e2e.md`。
- 详细测试报告（29 个用例 + 16 张截图）：`docs/reports/2026-11-26-f037-thread-first-e2e-detailed.md`。
- 非作者 review：墨墨 approve `e7b27af5b`（实质代码 `93997c049`），独立复核
  daemon 507 / web 109 / `npm run check` / CI 5/5。
- PR #211 landed `2db3f3b79135ea13bfd9692c06b31ab5af1c3c5a`；F037 实现与 E2E
  已进入 `superagentteam-work`。
- 剩余：operator 验收；F034/F035/F036 的正式栈签收项不变。

[宪宪/deepseek-flash🐾]
