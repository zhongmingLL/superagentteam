---
topics: [backlog]
doc_kind: note
created: 2026-10-25
---

# Feature Roadmap

> **Rules**: Index of all project Features (idea/spec/in-progress/review/done); status is current truth.
> Details in `docs/features/Fxxx-*.md`.
> New feature: allocate the next `Fxxx`, create `docs/features/Fxxx-*.md`, and add a BACKLOG row before implementation.
> Done features keep their row (status done); do not remove them at close. See `AGENTS.md` for the project override of the generic feat-lifecycle removal step.

| ID | Name | Status | Owner | Link |
|----|------|--------|-------|------|
| F001 | codeteam 架构 v1 | review | 宪宪 | [F001](docs/features/F001-architecture-v1.md) |
| F002 | W0a 下游基线与运行时能力验证 | done (cvo signoff) | 宪宪 | [F002](docs/features/F002-w0a-foundation-gate.md) |
| F003 | W0c daemon 最小生命周期 | done | 宪宪 | [F003](docs/features/F003-w0c-daemon-lifecycle.md) |
| F004 | W1 控制面数据模型 | done (operator confirmed) | 宪宪 | [F004](docs/features/F004-w1-control-plane-data-model.md) |
| F005 | W2 权限、身份与沙箱 | done (operator confirmed) | 宪宪 | [F005](docs/features/F005-w2-identity-sandbox.md) |
| F006 | W3 独立 Review 证据链 | done (operator confirmed) | 宪宪 | [F006](docs/features/F006-w3-independent-review.md) |
| F007 | W4 SOP 复用与点状 Gate | done (operator confirmed) | 宪宪 | [F007](docs/features/F007-w4-sop-gates.md) |
| F008 | W5a A2A 投递与球权内核 | done | 宪宪 | [F008](docs/features/F008-w5a-a2a-dispatch-custody.md) |
| F009 | W5b RPC Worker Runtime | done | 宪宪 | [F009](docs/features/F009-w5b-rpc-worker-runtime.md) |
| F010 | W5c 调度、资源与 F139 | done | 宪宪 | [F010](docs/features/F010-w5c-scheduling-resources.md) |
| F011 | W5d daemon lifecycle / deployment wait / managed work | done | 宪宪 | [F011](docs/features/F011-w5d-runtime-lifecycle-managed-work.md) |
| F012 | W6a Memory / Evidence 回源 | done | 宪宪 | [F012](docs/features/F012-w6a-memory-evidence.md) |
| F013 | W6c Observability / Trajectory | done | 宪宪 | [F013](docs/features/F013-w6c-observability-trajectory.md) |
| F014 | W6b Eval / Outcome / Harness Eval | done | 宪宪 | [F014](docs/features/F014-w6b-eval-outcome-harness-eval.md) |
| F015 | A2A E2E Foundation | done | 宪宪 | [F015](docs/features/F015-a2a-e2e-foundation.md) |
| F016 | W7a headless surface + A2A ingress E2E | done (F016a done; F016c-M1 S1–S5 done; F020 M0 closed; F016c-M2 S0–S4 merged: plan `ad18dad0`, S1 `7fe1c148`, S2 `00a9b0a2`, S3 `ed4fed04`, S4 `49b8114dd`; F016b deferred by D1=A; classic real-Hub E2E = optional compat track; operator close 2026-11-21) | 宪宪 | [F016](docs/features/F016-w7a-headless-surface.md) |
| F017 | A2A surface unification（post/cross-post + full A2A custody） | phase-a-archive (historical input; F018 owns A2A runtime v1) | 宪宪 | [F017](docs/features/F017-a2a-surface-unification.md) |
| F018 | A2A runtime v1（AgentConfig config-as-code；Thread/InvocationRecord/TurnExecution；post/cross/multi_mention/thread_context；纯 A2A；code delivery 冻结） | done | 砚砚 | [F018](docs/features/F018-thread-first-runtime.md) |
| F019 | SuperAgentTeam rename（platform/team/SOP 分层；`@superagentteam/*`；env/data/CLI/tool aliases；repo/branch last） | done (F019.5 alias cleanup complete) | 宪宪 | [F019](docs/features/F019-superagentteam-rename.md) |
| F020 | W7b thin Hub M0（自建 A2A Hub，参考 clowder 设计；classic Hub 降为可选兼容客户端） | done (M0 H0–H5 merged: `46b0cd19`/`5ae478aa`/`cf653a86`/`f5a68989`/`f4ef2602`/`7467a027`; carry: M0.5 hardening, real-worker busy smoke, classic Hub compat track) | 宪宪 | [F020](docs/features/F020-thin-hub-m0.md) |
| F021 | thin Hub M0.5 hardening（projectPath 校验、relogin 深链接、长 thread/busy live 证据） | done (implementation merged `e478f5b9`; dual review approve; operator close 2026-11-21) | 宪宪 | [F021](docs/features/F021-thin-hub-m05-hardening.md) |
| F022 | W7b thin Hub M1-A — unread/read state（sidebar 未读、per-thread read cursor、跨 tab 收敛） | done (implementation merged `a6ae8e40f`; dual review approve incl. P3 delta `31d982da2`; operator close 2026-11-21) | 宪宪 | [F022](docs/features/F022-thin-hub-m1-unread.md) |
| F023 | W7b thin Hub M1-B — thread rename（header inline edit、titleSource=user、sidebar 同步） | done (implementation merged `15d8ab9f5`; dual review approve @ `4aee2a75c`; operator close 2026-11-21) | 宪宪 | [F023](docs/features/F023-thin-hub-m1-rename.md) |
| F024 | W7b thin Hub M1-C — failed-invocation retry（failed/interrupted 回复重试、复用 requestRetry） | done (implementation merged `fffc32685`; P3 fix `cb5ef44d4`; dual review approve; operator close 2026-11-21; abandon/running cancel deferred to platform track) | 宪宪 | [F024](docs/features/F024-thin-hub-m1-retry.md) |
| F025 | Full-stack A2A E2E — Hub agent management + real-provider chain（多 agent 创建、同/跨 thread A2A、multi-mention、真实 provider） | done (merged `18e16a2f`; E2E passed 2026-11-22: 3 agents, thread1 A→B→A, multi-mention B+C, thread2 2 rounds, cross-thread 2-way; dual review approve @ `ce7edeae6`; operator close 2026-11-24) | 宪宪 | [F025](docs/features/F025-fullstack-a2a-e2e.md) |
| F026 | Local dev auto-login — Clowder-compatible localhost UX（loopback 直接访问，保留 CSRF；生产默认关闭） | done (merged `055182d6`; security review approve @ `4d0d24172`; Windows 3101 direct access verified; operator close 2026-11-24) | 宪宪 | [F026](docs/features/F026-local-dev-auto-login.md) |
| F027 | Hub visual refresh — 浅蓝理性工作台（nav rail + thread sidebar + 桌面/移动布局；保留 A2A 行为） | done (merged `de9e18061`; 墨墨 P2/P3 closed @ `6ff10c9ba`; operator merge 2026-11-23; operator close 2026-11-24) | 宪宪 | [F027](docs/features/F027-hub-visual-refresh.md) |
| F028 | Assistant execution record — thinking/tool calls 折叠 + live 中间结果（SSE；F018 merged toolEvents canonical） | done (merged `5615173fe`; 墨墨 vision/UX approve + 砚砚 contract/SSE approve @ `677ca2e50`; CI 5/5 @ `9ffec881d`; operator close 2026-11-24) | 宪宪 | [F028](docs/features/F028-assistant-execution-record.md) |
| F029 | Hub message surface parity — agent nameplate 宽度、A2A 收件人归属、rich blocks 展示 | done (merged `493aa01c3`; 墨墨 vision/UX approve @ `e44825788`; CI 5/5; operator close 2026-11-24) | 宪宪 | [F029](docs/features/F029-message-surface-parity.md) |
| F030 | Account & agent management — credential contract、account 设置页、agent 创建/编辑升级 | done (merged `a42cfcab5`; 砚砚 contract/security approve @ `12fa07ae8`; 墨墨 vision/UX approve @ `0b14e9bac`; CI 5/5; operator close 2026-11-24) | 宪宪 | [F030](docs/features/F030-account-agent-management.md) |
| F031 | Rich block producer — agent-created rich blocks in responses（producer tool、draft 暂存、settlement 落消息、rich-messaging skill） | done (merged `839b22f4a`; 砚砚 contract/security approve @ `656ebfec3`; 墨墨 vision/UX approve @ `656ebfec3`; CI 5/5; docs close `a5ca6aab0`; operator close 2026-11-24) | 宪宪 | [F031](docs/features/F031-rich-block-producer.md) |
| F032 | Task-first legacy retirement — archive reference, delete legacy runtime/shims/tests, keep historical docs | implemented — PR #184 merged `520929940`; archive `archive/task-first-v1` → `dd29e1cab`; daemon 469 / web 99 / skills 15 tests + `npm run check` green; operator close pending | 宪宪 | [F032](docs/features/F032-task-first-legacy-retirement.md) |
| F033 | Local runtime startup & worktree isolation — single entry, runtime/test worktrees, deterministic ports, managed lifecycle, Windows proxy | done — Phase B `e1ceb0e43`; Phase C `75a54a8e4`; Phase D `bac20a684` live runtime (new launcher, persistent data `~/.superagentteam-runtime/data`, cron retired); operator close 2026-11-25 | 宪宪 | [F033](docs/features/F033-runtime-startup-worktrees.md) |
| F034 | Agent run control — bounded automatic retries, cancel running agent, queue clarity | implemented — PR #195 merged `8ed21a710`; isolated E2E covers 5-retry cap + in-flight cancel; CI 5/5; deployed live `469e858ce`; live 3103 stop click pending operator | 宪宪 | [F034](docs/features/F034-agent-run-control.md) |
| F035 | Settings hub — sidebar Settings entry, accounts/agents pages | implemented — PR #196 merged `29f104852`; 墨墨 1440/390 visual + isolated create, 砚砚 aria/state approve; CI 5/5; deployed live `469e858ce`; design fix: settings is now a peer page (thread sidebar/topbar hidden) + Clowder-style sub-nav; live create pending operator | 宪宪 | [F035](docs/features/F035-settings-hub.md) |
| F036 | Chat surface polish — agent message bubble + operator avatar | implemented — PR #197 merged `469e858ce`; 墨墨 4-viewport visual approve @ `d25ebfe64`; CI 5/5; deployed live `469e858ce`; operator close pending | 宪宪 | [F036](docs/features/F036-chat-surface-polish.md) |

> Naming (F019): new and active docs use `superagentteam/Fxxx`; F001–F018 retain
> `codeteam/Fxxx` for history. Package/env/data/CLI/tool names use `superagentteam*`
> with `codeteam*` compatibility aliases; the repository is now
> `zhongmingLL/superagentteam` and the default branch is `superagentteam-work`.

> F016 是 W7a umbrella：F016a = A2A ingress/tool E2E，F016b = wait scheduler，
> F016c = headless API/Hub 兼容。Console M0 是 W7b，独立立项。
> F017 Phase A 已归档为历史输入；full A2A/custody 与 task-first 坐标不再作为
> 当前目标。F018 拥有 A2A runtime v1：InvocationRecord/TurnExecution 为执行锚，
> `a2a_send`/`handoff_*` 彻底弃用，v1 只做 post/cross/thread_context；
> code delivery/custody 冻结/弃用，后续能力在 A2A runtime 上逐步实现。
