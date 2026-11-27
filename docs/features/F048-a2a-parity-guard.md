---
feature_ids: [superagentteam/F048]
related_features: [superagentteam/F018, superagentteam/F043, superagentteam/F044, superagentteam/F045, superagentteam/F046, superagentteam/F047]
title: "F048: A2A parity guard & live acceptance"
status: planned
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: []
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-27
updated: 2026-11-27
source_decision: "operator 2026-11-27: 避免逐个 feature 再次偏移；建 parity guard 和 live 验收，feature 必须回链 0007/0019"
---

# F048: A2A parity guard & live acceptance

> **先读（强制）**：
> - [`0007-a2a-runtime-chain.md`](../architecture/0007-a2a-runtime-chain.md)：target contract。
> - [`0019-a2a-runtime-chain-as-built.md`](../architecture/0019-a2a-runtime-chain-as-built.md)：当前 as-built，原 0008 as-built。
> - [`0050-a2a-runtime-alignment.md`](../plans/0050-a2a-runtime-alignment.md)：本计划。
>
> 本 feature 只做 parity/guard/live 收口；不借机新增 runtime 功能。

## Why

0007 的 target 与 0019 的 as-built 已经出现过大偏移；F043 又是在偏移上补丁。为了
避免 F044–F047 再次逐 feature 漂移，需要一个独立 guard：把 Clowder parity 变成
可重跑测试，把“先读 0007/0019 + as-built delta”变成 PR/quality-gate 检查，并在
隔离环境跑完整 live 验收。

## 用户结果

- 触及 A2A runtime 的 PR 必须说明与 0007/0019 的差异和处置；缺说明直接 block。
- F044–F047 的语义有可重跑的 parity suite 守护，不靠 reviewer 记忆。
- 隔离 test runtime 与 runtime 的 live 验收都有记录；operator 可验收。

## 范围

- Clowder parity suite：parallel barrier、serial priorResponses、单 target serial
  前后处理、T2 ownership、A2A successor、multi-mention callback/auto-delivery、
  daemon 并发；每个测试回链 0007 章节。
- 架构 guard：PR 模板/quality-gate “architecture as-built delta” 检查；feature 文档
  强制先读块；`docs/README`/plan 索引一致。
- 隔离 live：test runtime（3007/3016）跑 F043 四场景 + 单 target serial +
  multi-mention callback；operator 授权后 runtime（3005/3014）。
- 0019 最终 as-built 更新；F043 superseded 状态收口。

## 非目标

- 不新增 route/queue/multi_mention 功能。
- 不改产品 UI 视觉（F047）。
- 不把 live 验收变成“代码写完即完成”；必须有命令/URL/结果。

## 验收

- [ ] AC-1：parity suite 覆盖 0007 §3.2/§3.5.1/§3.8/§3.9；全绿且可重跑。
- [ ] AC-2：PR 模板/quality-gate 有 architecture delta 检查；feature 文档有强制先读块。
- [ ] AC-3：隔离 test runtime 跑通 F043 四场景 + 单 target serial + multi-mention
  callback；记录 revision/URL/结果。
- [ ] AC-4：runtime 部署需 operator 授权；live 证据记录。
- [ ] AC-5：0019 更新为最终 as-built；F043 标 superseded；operator 验收。

## 证据

- 0007 §9.1/§9.2/§9.3 验收；0019 §8/§9。
- F043 live 证据（`docs/reports/2026-11-27-a2a-parallel-investigation.md` 与 F043 doc）。
- 0008 audit report: `docs/reports/2026-11-27-0007-as-built-audit.md`。

## 风险 / 回滚

- Guard 自身是 self-protection surface；改动需非作者 review（元风险）。
- Live 失败可回滚 feature 分支；不删除持久化数据；runtime 部署需 operator 授权。

[宪宪/deepseek-flash🐾]
