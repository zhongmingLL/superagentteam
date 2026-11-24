---
feature_ids: [superagentteam/F032]
related_features: [superagentteam/F018, superagentteam/F019, superagentteam/F031]
title: "F032: Task-first legacy retirement — archive reference, delete runtime"
status: implemented
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: [砚砚 (GLM 5.3 Flash), 墨墨 (Qwen 3.8 Flash)]
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-24
updated: 2026-11-24
source_decision: "operator 2026-11-24: `--engine legacy` / 旧 control.db 没有真实使用/数据要读；按 reuse 重核建议 archive-then-delete"
---

# F032: Task-first legacy retirement

## Why

F018 v1 已经是 thread-first A2A runtime，默认入口不再依赖 Task/Run/Handoff。
但仓库仍保留约 88 个文件的 `src/legacy/task-first/`、旧 path shim、legacy tests、
`scripts/legacy-boundary-allowlist.json` 的大量条目，以及 `--engine legacy` /
legacy control-plane 入口。operator 已确认：**没有真实 legacy 使用或 control.db
数据需要读取**。

继续维护两套 runtime 会持续支付 typecheck、测试、安全审计、文档误用和 onboarding
成本。F032 的目标是 **archive the reference, delete the runtime**：保留历史文档与
决策记录，删除可执行 legacy 代码，避免未来把 task-first 表/工具当 v1 契约。

## 现状基线

- `packages/superagentteam-daemon/src/legacy/task-first/`：约 88 文件 / 800K。
- `docs/legacy/task-first/`：约 40K，历史 archive。
- `scripts/legacy-boundary-allowlist.json`：仍有大量旧文件/shim 条目。
- 默认 A2A runtime 不读 legacy；但 `thread --engine legacy`、legacy control-plane
  option、旧 CLI commands/tests 仍可达。
- F018 v1 的 thread-first 口径见 `docs/architecture/0005-thread-first-runtime.md`；
  reuse 重核见 `docs/reports/2026-11-24-reuse-thread-first-revalidation.md`。

## 用户结果

- 默认 CLI/Hub/daemon 只暴露 A2A v1 路径；`--engine legacy` 不再出现。
- legacy 代码、shim、legacy-only tests、allowlist 条目从主分支移除；`rg` 不再找到
  活跃 import。
- 历史架构/决策文档仍在，但明确标为 non-normative archive；新开发不会被旧表名误导。
- 不删除任何用户数据；旧 `control.db` 已确认无读取需求，保留归档说明即可。
- 删除后 full build/check/test 与 A2A E2E 保持绿；boundary guard 增加 negative test。

## 分阶段

### F032.0 Archive + inventory（不删代码）

- 打 archive tag `archive/task-first-v1`，记录最后 legacy commit SHA。
- 生成 inventory：legacy code、shims、tests、allowlist、CLI flags/commands、docs links。
- 在 `docs/architecture/0006-task-first-legacy.md` 和 F032 记录 archive 坐标。

### F032.1 入口退场

- 移除 `--engine legacy` / legacy control-plane option / legacy-only CLI commands 的
  可执行入口；如保留命令名，必须 typed reject 并指向 A2A v1 替代。
- 更新 `--help`、README/SOP、错误文案，避免暗示 legacy 仍可用。
- 不迁移旧数据；不把 legacy table 写进 v1。

### F032.2 删除运行时

- 删除 `src/legacy/task-first/`、旧 path shim、legacy-only tests/fixtures。
- 清空 `scripts/legacy-boundary-allowlist.json` 中不再需要的条目；保留 v1 仍需的
  guard 配置（若有）。
- 删除仅服务 legacy 的 index/barrel exports。

### F032.3 历史留存 + 防回流

- 保留 `docs/architecture/0006-task-first-legacy.md`、decision packet/feature 历史与
  最终删除报告；`docs/legacy/task-first/` 标为非规范 archive，不再进正常文档索引。
- boundary guard 增加 negative test：legacy 表名/工具名/路径不得重新出现在 v1 目录。

### F032.4 验证

- `NODE_ENV=development npm run build:offline`
- `NODE_ENV=development npm run check`
- daemon targeted/full tests；web/skills 受影响面
- A2A v1 CLI `thread create/post/show` + 真实/模拟 provider 回合不回退
- `rg -n 'legacy/task-first|--engine legacy|controlPlane'` 只剩历史文档/归档说明

## 验收标准

- [x] AC-1：archive tag 存在，记录最后 legacy commit SHA；删除前后可回滚。
- [x] AC-2：默认 CLI/daemon 不再提供 legacy engine/control-plane 入口；帮助与错误文案一致。
- [x] AC-3：legacy code/shim/tests/allowlist 条目删除；无活跃 import。
- [x] AC-4：历史文档保留且明确 non-normative；F032 删除报告记录文件清单与验证命令。
- [x] AC-5：没有删除用户数据；旧 control.db 按“无读取需求”归档说明处理。
- [x] AC-6：full build/check/test + A2A E2E 绿；boundary guard negative test 生效。

## 进展

- 2026-11-24：F032.0 完成。archive tag `archive/task-first-v1` 指向
  `dd29e1cabbcf7907ee001c6c9440164697d0747e`；inventory 报告
  `docs/reports/2026-11-24-f032-legacy-inventory.md` 记录 88 files / 800K legacy code、
  55 allowlist entries、52 个非 legacy shim 文件、3 个直接 import legacy 的测试，
  以及 legacy CLI/daemon 入口。下一步 F032.1 入口退场。
- 2026-11-24：F032.1 完成。CLI 现在只暴露 `auth` / `thread` / `daemon` / `memory`；
  `thread --engine legacy` 与 `backlog/sop/task/approval/budget/deployment/schedule/
  session/profile/gate/merge/eval` 返回 typed `legacy_engine_retired` /
  `legacy_command_retired`。`startDaemon` 移除 legacy `controlPlane` option，默认且
  唯一 control plane 是 A2A v1；`daemon status` 不再打开 `control.db`。直接依赖
  legacy 入口的 CLI/daemon tests 同步移除。PR #183 合入 `7a41a2c8c`。
- 2026-11-24：F032.2 完成。删除 `src/legacy/task-first/`、旧 path shim、control
  stores、dispatch/review/merge/gates/sop/scheduling/eval/policy/deployment-wait/
  custody 及其 legacy-only tests/fixtures；`legacy-boundary-allowlist.json` 清空。
  保留 v1 需要的 `control/errors.ts`、`data-dir.ts` 和 Hub disabled-route shim。
  净删除约 45.5K 行；daemon 68 files / 469 tests 通过，`npm run check` 全绿。
- 2026-11-24：F032.3 完成 + 砚砚 P2 收口。历史文档加 non-normative 删除声明；
  boundary guard 增加负向自测。为消除“保留模块失去覆盖”，删除只服务 legacy
  control.db 的 `memory/digest.ts` 与 `memory/sources/control.ts`，memory 变为纯
  file-source；memory CLI 的 `digest` 子命令移除。剩余 F032.4 full gate。
- 2026-11-24：F032.2/3 合入 `520929940`（PR #184，双审覆盖到 `531e8e6e6`；
  CI 5/5 绿）。F032.4 完成：`npm run build:offline` / `npm run check` / daemon
  469 tests / web 99 / skills 15 全绿；CLI A2A smoke 只生成 `f018.db`；
  boundary guard 自测 + allowlist `{}` 生效。F032 进入 `implemented`，等 operator
  close。

## 非目标

- 不重做 code delivery / task / custody / approval / SOP runtime；这些能力要重新立项时
  按 thread-first 重写。
- 不迁移 legacy 数据到 v1，不创建第二套 legacy 读面。
- 不在 W8 Forge connector 里顺手删除；F032 是独立 feature。

## 依赖与风险

- 依赖 operator 已确认无 legacy 使用/数据（2026-11-24）。
- 风险：隐藏脚本/测试仍依赖 legacy → F032.0 inventory + `rg`/CI 全量先红后删。
- 风险：CLI 用户脚本使用旧命令 → archive tag + 文档迁移说明；删除是可回滚的。
- 风险：历史文档误用 → 非规范 banner + 文档索引移除 + reuse 卡已标 deferred。

## 开放问题

- `docs/legacy/task-first/` 是留在 `docs/` 作为 archive，还是移到独立 archive 目录？
  F032.0 给出文件清单后由 operator 确认；默认留在原目录并标明 non-normative。
- 旧 `control.db` 是否保留只读副本；已确认无读取需求，默认只归档说明、不复制数据。

[宪宪/deepseek-flash🐾]
