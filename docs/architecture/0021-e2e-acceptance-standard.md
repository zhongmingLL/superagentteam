---
title: "0021: E2E acceptance standard (F044 method)"
doc_kind: architecture
status: active
created: 2026-11-28
updated: 2026-11-28
source_decision: "operator 2026-11-27/28: 按 0007/F044 ownership 重新设计 E2E；真实前后端 + 真实 account/agent；F045 及后续 feature 都按 F044 方式测试"
---

# 0021: E2E acceptance standard (F044 method)

> 适用范围：F037 的后续矩阵、F044–F051 的所有功能验证、以及之后任何
> thread-first / A2A feature。**这是 operator 对 F044 测试意图与方式的固化**；
> feature 文档里的 `AC-E2E` 必须引用本标准，不能用 unit/targeted test 替代。

## 1. Operator intent（为什么这样测）

2026-11-27 operator 对 F037 的纠正：

- 旧 F037 矩阵是 F044 之前按 inline fan-out 设计的，**不能拿旧用例换标签复跑**；
  那只能证明旧行为还活着，不能证明 0007/F044 纠正后的 ownership、barrier、
  Phase B/T2 边界。
- 前端、后端、真实 account/agent 都已经具备，**必须利用真实场景**；只在 mock 上
  跑控制面不算验收。
- 每个 feature 先按当前 target contract 设计用例，再逐项执行、记录证据、暴露 bug、
  修复并留回归；不能把“功能存在”当成“契约成立”。

## 2. 分层（B / U / P）

| 层 | 组成 | 用途 |
|---|---|---|
| **B** | 真实 daemon + 真实 pi worker + mock provider | 确定性控制面/ownership/时序；mock 只负责模型输出与可控故障 |
| **U** | 真实 Hub 前端 + 真实 daemon（provider 可为 mock 或真实） | 真实操作面、SSE、布局、截图；交互必须走浏览器 |
| **P** | 真实 pi worker + 真实 provider/account | 真实模型链路；成功路径的最终证明 |

规则：

- **成功路径最终必须有 P 层证据**（真实 account/provider）。B 层 mock 结果不能写成
  “真实模型已验证”。
- **失败/故障路径**可以用 mock 精确注入（500、延迟、Phase B throw），但也必须走
  真实 daemon/worker 链路；注入点要打在组合根共享的真实实例上。
- 同一 feature 的 B/U/P 证据分别标注 `real` / `mock`；不混写。

## 3. 用例设计

- 用例必须对准当前契约（0007 + 0019 + 对应 feature doc），并写明它约束的
  ownership/时序/状态机；能区分新旧实现的断言优先（例如 route 时代日志、T2 单写者、
  cursor 边界）。
- 每个用例至少包含：ID、层（B/U/P）、场景、契约约束、证据类型、状态。
- 旧矩阵/旧截图只能作为历史参考，不能作为当前 feature 的 fresh evidence。
- 已知缺口显式标 `known-gap`，不塞进 pass。

## 4. 隔离与安全

- 代码改动使用独立 worktree；测试使用独立 data dir。
- UI/daemon 使用 test 端口 **3007/3016**（或进程内 ephemeral port + `mkdtemp`）；
  **不读写 runtime 3005/3014、`~/.superagentteam-runtime/data` 或生产用户数据**。
- 真实 provider key 只从 `0600` env file / 环境注入，不打印、不写进日志/报告/
  commit；报告中只写 key ref 名称。
- 测试结束清理临时 data dir；不留下后台 daemon/worker。

## 5. 证据包（每个 feature 必须留下）

1. 命令与结果（含失败/重试）。
2. worktree + HEAD；review/CI 的 headSha 必须与最终 HEAD 逐字一致。
3. 隔离坐标：data dir、端口、provider/account ref（不含 key）。
4. 逐用例证据：daemon/worker/queue 日志关键行（event + id/count，不带正文）、
   DB 坐标（parent/attempt/turn/R 状态）、UI 截图（1440/390 light/dark 按需）。
5. 回归用例路径；修复类 bug 要有 RED→GREEN 证明。
6. 合后基线（daemon/web/typecheck/doc-index 中受影响项）。

## 6. 完成与 review

- `AC-E2E` 未满足 = feature 不能声明 `implemented/verified`；没有 fresh E2E 不得用
  “已实现”代替“已验证”。
- 非作者 review 覆盖最终实质 HEAD；hotfix/风险变更按家规找非作者。
- merge-gate 消费：CI 全绿 @ 最终 HEAD + review verdict；合后跑基线并记录 merge SHA。
- 真实 provider 失败（401/限流/超时）如实记为失败/降级证据，不写成 pass；必要时
  保留失败截图与 attempt 状态。

## 7. 参考实现

| 参考 | 位置 | 说明 |
|---|---|---|
| B 层 route-first | `packages/superagentteam-daemon/test/f044-route-fullstack-e2e.test.ts` | 真实 daemon+worker+mock；R1–R4/R7；route 日志机械区分器 |
| U/P 层真实 Hub | `docs/reports/2026-11-28-f044-route-e2e-v2.md` | 真实 Kimi 单 agent/多 target、停止、401 失败+retry、截图 |
| F045 契约 + 真实 P 层 | `f045-context-history-e2e.test.ts` + `f045-context-history-live.e2e.test.ts` | B 层 cursor/barrier + 真实 Kimi C1/C2 |
| 用例矩阵 | `docs/plans/0052-route-first-e2e-v2.md` | ID/层/契约/证据/状态 |

## 8. 自检清单

- [ ] 用例来自当前 0007/0019/feature 契约，不是旧矩阵复跑。
- [ ] B 层真实 daemon+worker；失败注入在真实事务边界。
- [ ] 成功路径有 P 层真实 provider 证据。
- [ ] UI 用例走真实 Hub 浏览器，不是组件单测。
- [ ] 隔离 data dir/端口；未触碰 3005/3014；key 未泄漏。
- [ ] 日志/DB/截图证据齐全；mock/real 明确标注。
- [ ] RED→GREEN（回归/修复类）；known-gap 显式。
- [ ] CI headSha = review HEAD；合后基线已记录。

[宪宪/deepseek-flash🐾]
