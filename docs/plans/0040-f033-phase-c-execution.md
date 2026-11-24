---
title: "F033 Phase C execution — test worktree, port isolation, old-stack cleanup"
doc_kind: plan
status: active
created: 2026-11-25
updated: 2026-11-25
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: [砚砚 (GLM 5.3 Flash), 墨墨 (Qwen 3.8 Flash)]
feature: F033
related_features: [superagentteam/F018, superagentteam/F032]
related: [features/F033-runtime-startup-worktrees.md, plans/0038-f033-runtime-startup-worktrees.md, plans/0039-f033-phase-b-execution.md]
source_decision: "operator 2026-11-25: continue F033 after Phase B; DP-F033-2=A fixed test ports"
---

# F033 Phase C — test/acceptance isolation & cleanup

## 范围

- test/acceptance worktree：repo sibling `superagentteam-alpha`，只消费已合入代码。
- 独立 data dir、env file、端口：`3007/3016`；不读写 runtime `3005/3014` 的用户数据。
- port registry + CI drift/conflict guard：runtime/test/reserved 端口单一真相源，CLI 默认值不得静默漂移。
- 旧 stack 清理：WSL 旧栈与 Windows `3100/3101` proxy 收尾；只保留当前 `3103`。

## 进展（2026-11-25）

- test worktree `/home/ming/agent/superagentteam-alpha` at `04b087379`；`npm install --ignore-scripts` + `build:offline` 绿。
- test stack：`--web-port 3007 --daemon-port 3016`，data `~/.superagentteam-alpha/data`，env `~/.config/superagentteam/alpha.env`；start → running → status → end 全绿，端口释放，runtime `3103` 不受影响。
- port registry：`scripts/superagentteam/runtime-ports.mjs`（runtime 3005/3014/3103，test 3007/3016，reserved 3003/3004）；`scripts/superagentteam/runtime-ports.test.mjs` 覆盖重复、保留端口、越界和 CLI 默认值漂移；`check:runtime-ports` 已接入 `npm run check`。
- 旧 WSL 栈 4 套 data dir 已快照到 `/home/ming/superagentteam-archive/20261124T173508Z/` 并收尾。
- 旧 Windows proxy `3100`/`3101` 经 PID + command line 身份核验后停止；只剩当前 `3103`（`f028-wsl-proxy-3103.ps1`）。

## 验证

- `node scripts/superagentteam/runtime-ports.mjs`
- `node --test scripts/superagentteam/runtime-ports.test.mjs`
- alpha test stack start/status/end；`3007/3016` 端口释放；`http://localhost:3103/` 仍 200。
- `npm run check` 由 CI 覆盖。

## 残余

- Phase D：runbook、cron watchdog 退役、Windows proxy 生成脚本与单 URL 验收、最终 feature close。

[宪宪/deepseek-flash🐾]
