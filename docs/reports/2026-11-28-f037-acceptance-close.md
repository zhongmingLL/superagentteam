---
title: "F037 acceptance close-out"
doc_kind: report
status: active
created: 2026-11-28
updated: 2026-11-28
source_decision: "operator 2026-11-28: F037 相关测试已 pass，可以验收"
---

# F037 acceptance close-out

## 验收决定

- operator 2026-11-28 明确验收通过（“可以验收”）。
- F037 feature / BACKLOG / plan 0046 收口为 `done`；F037 v2 任务同步完成。
- F037 验收时 runtime：`dceb0f86e`（web 3005 / daemon 3014，health/write path 正常）；
  后续 F052 部署已升级到 `af82e157`。
- 最终 docs main 收口前的 F037 相关 merge：`4ddcebdfa`；本报告随收口 PR 合入。

## 交付证据

- F037 主交付：PR #211 landed `2db3f3b79`，reviewed `e7b27af5b`，墨墨 approve，CI 5/5。
- U5–U7 真实 Hub + 真实 Kimi：`2026-11-28-f037-u5-u7.md`；rich block、Settings、
  1440/390 光暗、键盘发送。
- 真实 provider 链路：F045/F046/F048 live suites + F037 U5/U6/U7；跨 thread、
  multi_mention、post_message、cross_post_message、停止/重试均已实测。
- 最终回归：web 25 files / 120 tests；daemon 561 passed / 5 skipped；CI 5/5。

## Bug 收口

| Bug | 级别 | 状态 |
|---|---|---|
| BUG-F037-001 移动端 Settings 入口/返回 | P2 | fixed |
| BUG-F037-002 A2A 仅标签 body 的 prompt 语义 | P3 | deferred（文档化，不在 F037 改契约） |
| BUG-F037-003 multi-mention target 回复完成后消失 | P2 | fixed（PR #266 `7fe438118`） |
| BUG-F037-004 A2A/private 气泡对齐与 post_message 标签/横线 | P2 | fixed（PR #266 `7fe438118`） |
| BUG-F037-005 cross_post 呈现误导 | P2 | fixed（PR #268 `dceb0f86e`） |
| BUG-F051-001 F051a move 后 worker CLI 路径 | P1 | fixed（PR #264 `e1d1dd38b`） |

## 非目标限制

- real provider 长尾/限流仍只覆盖单次成功回合；没有受控限流器，不能外推为全矩阵稳定性。
- 该限制不是 F037 验收门；已在 F050 live acceptance 与相关报告中保留。

## 关键报告

- `docs/reports/2026-11-26-f037-thread-first-e2e.md`
- `docs/reports/2026-11-26-f037-thread-first-e2e-detailed.md`
- `docs/reports/2026-11-28-f037-u5-u7.md`
- `docs/reports/2026-11-28-f037-acceptance-a2a-bubbles.md`
- `docs/reports/2026-11-28-f037-cross-post-bubble.md`
- `docs/reports/2026-11-28-f051c-runtime-path-hotfix.md`

[宪宪/deepseek-flash🐾]
