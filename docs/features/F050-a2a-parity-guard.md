---
feature_ids: [superagentteam/F050]
related_features: [superagentteam/F018, superagentteam/F043, superagentteam/F044, superagentteam/F045, superagentteam/F046, superagentteam/F047, superagentteam/F048]
title: "F050: A2A parity guard & live acceptance"
status: implemented
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: [砚砚 (GLM 5.3 Flash)]
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-27
updated: 2026-11-28
source_decision: "operator 2026-11-27: 纠正所有 0007↔当前实现偏移；建 parity guard，feature 必须回链 0007/0019/audit"
---

# F050: A2A parity guard & live acceptance

> **先读（强制）**：
> - [`0007-a2a-runtime-chain.md`](../architecture/0007-a2a-runtime-chain.md)：target contract。
> - [`0019-a2a-runtime-chain-as-built.md`](../architecture/0019-a2a-runtime-chain-as-built.md)：当前 as-built，原 0008 as-built。
> - [`2026-11-27-0007-as-built-audit.md`](../reports/2026-11-27-0007-as-built-audit.md)：A–F 偏移证据。
> - [`0050-a2a-runtime-alignment.md`](../plans/0050-a2a-runtime-alignment.md)：本计划与覆盖矩阵。
>
> 本 feature 只做 parity/guard/live 收口；不借机新增 runtime 功能。

## 覆盖的 audit 偏移

**全表收口 + E1/E4 验收 + F6–F7 no-action**：

- 逐行核对 audit A–F，记录 fixed / doc-aligned / no-action 证据。
- E1/E4 的验收措辞最终对齐。
- F6–F7 记录为 aligned/no-action。

## Why

0007 target 与 as-built 已经出现过大偏移；上一版拆分只修 F043 暴露的问题，漏了
A/B/C/D/E/F 的大量偏移。为了避免 F044–F048 + F043 AC-4 再次逐 feature 漂移，需要独立 guard：
把 Clowder parity 变成可重跑测试，把“先读 0007/0019/audit + as-built delta”变成
PR/quality-gate 检查，并在隔离环境跑完整 live 验收。

## 用户结果

- 触及 A2A runtime 的 PR 必须说明与 0007/0019/audit 的差异和处置；缺说明直接 block。
- F044–F048 + F043 AC-4 的语义有可重跑的 parity suite 守护，不靠 reviewer 记忆。
- audit A–F 每一行都有 fixed / doc-aligned / no-action 证据。
- 隔离 test runtime 与 runtime 的 live 验收都有记录；operator 可验收。

## 范围

- Clowder parity suite：parallel barrier、serial priorResponses、单 target serial
  前后处理、T2 ownership、A2A successor、multi-mention callback/auto-delivery、
  daemon 并发、DDL/API 对账；每个测试回链 0007 章节。
- 架构 guard：PR 模板/quality-gate “architecture as-built delta” 检查；feature 文档
  强制先读块；`docs/README`/plan 索引一致。
- Audit 收口表：A–F 每行状态 + 证据；aligned/no-action 也要写原因。
- 隔离 live：test runtime（3007/3016）跑 F043 四场景 + 单 target serial +
  multi-mention callback；operator 授权后 runtime（3005/3014）。
- F043 AC-4 实机视觉验收：真实 Hub 框架（topbar/sidebar/composer）+ 真实 thread 的
  私有气泡/汇总卡，1440/390、光暗各一组；没有这组图不把 AC-4 标成 live complete。
- F043 AC-4 视觉 follow-ups（review 记录）：footer “汇总已交给 X”按
  `received === rows.length` 分完成/将完成语气；replyTo 锚向被隐藏 response 时的
  展开定位；question 改为结构化字段后的迁移；multi-mention trigger 公开 nameplate
  与汇总卡 question 双显示；crossPost 保持公开 badge；被隐藏 response 的
  `mentionsUser` 是否上浮到卡片。
- 0019 最终 as-built 更新；F043 superseded 状态收口。

## 非目标

- 不新增 route/queue/multi_mention 功能。
- 不改产品 UI 视觉（F043 AC-4）。
- 不把 live 验收变成“代码写完即完成”；必须有命令/URL/结果。

## 验收

- [x] AC-1：parity suite 覆盖 0007 §3.2/§3.5.1/§3.8/§3.9 + audit A–F 整改项；全绿可重跑。
- [x] AC-2：PR 模板/quality-gate 有 architecture delta 检查；feature 文档有强制先读块。
- [x] AC-3：audit A–F 每行有 fixed / doc-aligned / no-action 证据。
- [x] AC-4：隔离 test runtime 跑通 F043 四场景 + 单 target serial + multi-mention
  callback；记录 revision/URL/结果。
- [ ] AC-4b：F043 AC-4 实机截图（1440/390、光暗、真实 Hub 框架）齐备；否则 AC-4
  只算 implemented，不算 live complete。
- [ ] AC-5：runtime 部署需 operator 授权；0019 更新为最终 as-built；F043 标 superseded；
  operator 验收。
- 注意（P3-b，#240 review）：`workspace_unavailable` 当前是 target-contract 预留名，
  daemon src 无抛出点、测试零覆盖；F050 只能标 “contract-reserved, no runtime path”，
  不能标成 “verified”。

- [ ] AC-E2E（operator 2026-11-27，强制）：必须在**当前测试 worktree**的隔离 test runtime
  跑真实端到端链路；**Clowder 是 golden**，parity 用例先按 Clowder 参考实现/测试构建，
  再在本仓复现；执行时观察并输出 daemon/worker/queue 日志关键行；unit/targeted test
  只能补充，不能替代 AC-4/AC-4b 的隔离 runtime/Hub 验收。证据须含 worktree/HEAD、
  隔离端口/data dir、用例、日志/输出、结果；无 E2E 证据不得声明 verified/live。
  方式基线：[`0021-e2e-acceptance-standard.md`](../architecture/0021-e2e-acceptance-standard.md)
  （F044 方法）；F050 是把该标准落到 parity suite + 真实 Hub 验收的收口 feature。

## 证据

### F050 收口证据（2026-11-28 @ `2443b1836`）

- **Parity guard**：`packages/superagentteam-daemon/test/f050-parity-guard.test.ts`
  （5/5）——锁定 0007 Trigger snapshot/successor/rich block/auto-delivery、
  无列级 UNIQUE、json_type checks、0019 final as-built 标记、AGENTS+feature→0021
  强制引用、audit A–F 每行 disposition、PR 模板 architecture/E2E 段。
- **Parity 行为证据（已有套件，同 HEAD 重跑）**：
  - `f044-route-fullstack-e2e.test.ts` **12/12**：R1 parallel barrier、R2 delivered
    failure/retry、R3 cancel、R4 cross_post、R7 Phase B faults、F048 独立 entry/保序/
    抢占、F046 multi_mention、F046b successor T2。
  - `f045-context-history-live.e2e.test.ts` 2/2（真实 Kimi）；`f048-queue-concurrency-live.e2e.test.ts`
    1/1（真实 Kimi 长 turn + 独立 entry）；`f046-multi-mention-live.e2e.test.ts` 1/1
    （B/C 真实 Kimi aggregate+callback）；`f047-schema-parity.test.ts` 1/1。
- **Audit A–F 收口表**：`docs/reports/2026-11-28-a2a-alignment-close.md`，逐行
  fixed/doc-aligned/no-action；`workspace_unavailable` 标 contract-reserved。
- **架构 guard**：`.github/pull_request_template.md` 强制 Architecture delta（0007/0019/
  audit）与 E2E evidence（0021）两段。
- **0019/F043**：0019 标 final-as-built；F043 标 superseded（前端 AC-4 已交付）。
- **AC-4b / AC-5 未关闭**：F043 AC-4 的 A2A 私有气泡/汇总卡实机 1440/390 光暗截图与
  operator 视觉验收仍待；runtime 3005/3014 部署需 operator 显式授权。F037 U5–U7 的
  fresh Hub 截图覆盖 rich block/Settings/responsive，但不冒充 F043 AC-4b。

- **Clowder 参考测试路径**（相对参考仓根目录）：
  - `packages/api/test/route-parallel-*.test.js` / `route-serial-*.test.js`
  - `packages/api/test/invocation-queue.test.js` / `invocation-tracker.test.js`
  - `packages/api/test/multi-mention-*.test.js` / `route-serial-callback-dedup.test.js`
  - `packages/api/test/context-assembler.test.js` / `incremental-context-*.test.js`
- 0007 §9.1/§9.2/§9.3 验收；0019 §8/§9；audit A–F 全表。
- F043 live 证据（`docs/reports/2026-11-27-a2a-parallel-investigation.md` 与 F043 doc）。
- 0007 audit report: `docs/reports/2026-11-27-0007-as-built-audit.md`。

## 风险 / 回滚

- Guard 自身是 self-protection surface；改动需非作者 review（元风险）。
- Live 失败可回滚 feature 分支；不删除持久化数据；runtime 部署需 operator 授权。

[宪宪/deepseek-flash🐾]
