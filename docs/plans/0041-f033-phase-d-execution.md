---
title: "F033 Phase D execution — script layout, runbook, cron retirement"
doc_kind: plan
status: active
created: 2026-11-25
updated: 2026-11-25
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: [砚砚 (GLM 5.3 Flash), 墨墨 (Qwen 3.8 Flash)]
feature: F033
related_features: [superagentteam/F018, superagentteam/F032]
related: [features/F033-runtime-startup-worktrees.md, plans/0039-f033-phase-b-execution.md, plans/0040-f033-phase-c-execution.md, runbooks/F033-local-runtime.md]
source_decision: "operator 2026-11-25: continue F033 to Phase D"
---

# F033 Phase D — script layout, runbook, retirement

## 范围

- 脚本分层：`scripts/superagentteam/` 放运行面脚本；`scripts/` 根保留 upstream pi / release / check 工具。
- 正式内部 launcher `scripts/superagentteam/runtime-daemon.mjs`；旧 `scripts/f025-e2e-daemon.mjs` 保留兼容 wrapper。
- port registry 迁到 `scripts/superagentteam/runtime-ports.mjs`；CLI drift guard 继续在 CI。
- Windows proxy 校验：`scripts/superagentteam/windows-proxy.mjs check`。
- runbook：`docs/runbooks/F033-local-runtime.md`。
- cron watchdog 退役；无 supervisor 按 DP-F033-3=defer。

## 进展

- 2026-11-25：runtime launcher 已迁到 `scripts/superagentteam/runtime-daemon.mjs`；兼容 wrapper 保留。
- port registry/test 已迁到 `scripts/superagentteam/`，`check:runtime-ports` 指向新路径。
- Windows proxy check 已落地并实测 3103 root/session 200。
- runbook 已落 `docs/runbooks/F033-local-runtime.md`。
- cron watchdog 已备份到 `/home/ming/superagentteam-archive/20261124T173508Z/cron/` 并退役；runtime 3103 仍 200。
- Windows proxy 模板 `windows-proxy.ps1` + bridge + `windows-proxy.mjs check` 已实测；`print` 给出重新生成命令。
- 最终 runtime worktree ff-only 更新/rebuild/restart 在 PR 合入后执行。
- 墨墨 P2：runtime data dir 从 `/tmp/f028-demo-1795448211/data` 迁到 `~/.superagentteam-runtime/data`；旧目录快照到 `/home/ming/superagentteam-archive/20261124T173508Z/runtime-data-before-persistent-migration/`。新路径启动后 3103/`/api/session` 200；runbook 全部示例已改持久路径。
- live runtime worktree 已 ff-only 到 `bac20a684` 并 rebuild；`runtime end`→`runtime start` 后 daemon command = `scripts/superagentteam/runtime-daemon.mjs`，数据仍为 `~/.superagentteam-runtime/data`，3103/session 200。
- alpha worktree 同步 `bac20a684`；test stack `3007/3016` start/status/end 闭环，端口释放，3103 不受影响。

## 验证

- `node scripts/superagentteam/runtime-ports.mjs`
- `node --test scripts/superagentteam/runtime-ports.test.mjs`
- `node scripts/superagentteam/windows-proxy.mjs check`
- runtime worktree ff-only 更新 + build + restart；3103 root/session 200
- `npm run check` 由 CI 覆盖

[宪宪/deepseek-flash🐾]
