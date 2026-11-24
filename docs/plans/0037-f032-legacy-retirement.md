---
title: "F032 execution plan — task-first legacy retirement"
doc_kind: plan
status: in-progress
created: 2026-11-24
updated: 2026-11-24
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: [砚砚 (GLM 5.3 Flash), 墨墨 (Qwen 3.8 Flash)]
feature: F032
related_features: [superagentteam/F018, superagentteam/F019]
related: [features/F032-task-first-legacy-retirement.md, architecture/0006-task-first-legacy.md, reports/2026-11-24-reuse-thread-first-revalidation.md]
source_decision: "operator 2026-11-24: no legacy usage/data; archive reference then delete runtime"
---

# F032 execution plan

## Goal

删除已冻结的 task-first runtime，只保留历史文档/决策记录；默认产品面只留 A2A v1。

## F032.0 Archive + inventory

1. 记录当前 HEAD 与 legacy 范围：

```bash
git rev-parse HEAD
git tag archive/task-first-v1 <last-legacy-commit>
find packages/superagentteam-daemon/src/legacy/task-first -type f | sort
rg -n 'legacy/task-first|--engine legacy|controlPlane' packages/superagentteam-daemon/src packages/superagentteam-daemon/test scripts docs
```

2. 生成 `docs/reports/2026-11-24-f032-legacy-inventory.md`：
   - 文件/目录清单、行数/大小；
   - shim → legacy target 映射；
   - legacy-only tests/fixtures；
   - allowlist entry 清单；
   - CLI flags/commands；
   - docs links。

3. 在 `docs/architecture/0006-task-first-legacy.md` 顶部写 archive tag + commit。

## F032.1 Entrypoints

- `thread --engine legacy`：移除 option，或保留参数但 typed reject
  `legacy_engine_retired` 并指向默认 A2A。优先移除，避免“看起来还能用”。
- `startDaemon` 的 `controlPlane` legacy option：从公开 options 移除；若测试仍需要，
  只保留在 legacy 删除前的临时 fixture，不进产品入口。
- 旧 CLI commands（`backlog/task/approval/budget/deployment/gate/merge/schedule/sop/
  eval/profile/session` 中仅 legacy 的部分）逐个核：能映射到 A2A v1 的保留/改名，
  不能的直接移除并在 help/README 说明。
- 更新 `--help` 和错误文案；不允许 legacy command 静默降级。

## F032.2 Delete runtime

删除范围（以 inventory 为准）：

- `packages/superagentteam-daemon/src/legacy/task-first/`
- `packages/superagentteam-daemon/src/{dispatch,scheduling,review,merge,gates,sop,
  managed-work,deployment-wait,custody}/` 中仅 re-export legacy 的 shim
- `packages/superagentteam-daemon/src/a2a/` 旧 shim 文件（保留 v1 surface）
- legacy-only tests/fixtures
- `scripts/legacy-boundary-allowlist.json` 对应条目
- `src/index.ts` / barrels 的 legacy exports

保留：

- `docs/architecture/0006-task-first-legacy.md`
- decision packet / feature 历史
- 最终删除报告
- boundary guard 中防止 legacy 回流的规则

## F032.3 Verification

```bash
NODE_ENV=development npm run build:offline
NODE_ENV=development npm run check
NODE_ENV=development npm test -w @superagentteam/daemon
NODE_ENV=development npm test -w @superagentteam/web
NODE_ENV=development npm test -w @superagentteam/skills
```

额外：

- `thread create/post/show` 与 A2A provider 回合 E2E；
- `rg` 断言 legacy path/engine 只剩 archive 文档；
- boundary guard negative test（legacy table/tool name 不得回流）。

## Rollback

- 从 `archive/task-first-v1` tag 恢复 legacy 文件；
- 不迁移/删除用户数据；旧 `control.db` 只在归档说明中记录；
- F032 是独立 PR，不与 W8 混在一起。

## Review

- 砚砚：CLI/daemon auth、删除边界、legacy path 不可回流、无隐藏数据读取。
- 墨墨：operator 可读的 help/错误文案、历史文档 non-normative 标记。
- 作者不能自审；full build/check/test + E2E 证据随 PR。

## 进展

- 2026-11-24：F032.0 完成。tag `archive/task-first-v1` 已推送，指向
  `dd29e1cabbcf7907ee001c6c9440164697d0747e`；inventory 报告
  `docs/reports/2026-11-24-f032-legacy-inventory.md` 已落。
- 2026-11-24：F032.1 完成。`thread --engine legacy` 与 12 个 legacy-only CLI
  command 已 typed reject；`startDaemon` 只接受 A2A control plane；`daemon status`
  不再打开 `control.db`。legacy CLI/daemon tests 与仅服务它们的 helper 已移除。
  PR #183 合入 `7a41a2c8c`。
- 2026-11-24：F032.2 完成。删除 legacy runtime、旧 path shim、control stores、
  dispatch/review/merge/gates/sop/scheduling/eval/policy/deployment-wait/custody
  及 legacy-only tests/fixtures；allowlist 清空。v1 只保留 A2A/daemon/memory/
  observability/auth/lifecycle/paths/state。daemon 469 tests + `npm run check` 绿。
- 2026-11-24：F032.3 进行中。历史文档加 non-normative 删除声明；boundary guard
  增加负向自测（legacy path/retired tool/frozen table）。
- 2026-11-24：砚砚 P2 收口。删除 `memory/digest.ts` 与 `memory/sources/control.ts`
  （仅服务 legacy control.db 且失去覆盖），memory 改为纯 file-source；
  `memory digest` 子命令移除。memory v1 测试仍覆盖 index/recall/trigger。
- 下一步：F032.4 full build/check/test + A2A CLI/provider E2E，然后收口。

[宪宪/deepseek-flash🐾]
