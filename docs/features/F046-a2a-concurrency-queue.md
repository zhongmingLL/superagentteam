---
feature_ids: [superagentteam/F046]
related_features: [superagentteam/F018, superagentteam/F043, superagentteam/F044, superagentteam/F048]
title: "F046: A2A concurrency & queue parity"
status: planned
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: []
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-27
updated: 2026-11-27
source_decision: "operator 2026-11-27: F043 的并发/排队是补丁；按 0007 route+queue 设计恢复 per-agent slot 与独立 entry 并发"
---

# F046: A2A concurrency & queue parity

> **先读（强制）**：
> - [`0007-a2a-runtime-chain.md`](../architecture/0007-a2a-runtime-chain.md)：target contract。
> - [`0019-a2a-runtime-chain-as-built.md`](../architecture/0019-a2a-runtime-chain-as-built.md)：当前 as-built，原 0008 as-built。
> - [`0050-a2a-runtime-alignment.md`](../plans/0050-a2a-runtime-alignment.md)：本计划。
>
> 本 feature 只实现计划切片；并发上界与 per-agent slot 不得为“跑得快”而放宽。

## Why

F043 Q4 的“D 长跑阻塞 C”根因是 `DaemonA2A.tick` 全局 single-flight + `drain`
await 完整 turn。F043 把它改成有界并发 drain，但这是补在旧 QueueProcessor 上的。
0007 的 route/queue 设计本来就允许不同 target 的 entry 由后续 drain 并行，同时用
per-(thread, agent) tracker slot 保证同 agent 顺序；F046 把这一语义做成正式实现，
并补 backpressure/read model。

## 用户结果

- 一只 agent 长跑时，其他 agent 的独立消息仍能启动，不被长 turn 挡住。
- 同一 agent 的后续消息仍按顺序等待，不会双启。
- queue/live 面板只显示真正等待的投递；运行中的长 turn 不被误报为排队。
- 并发有上界，不会因为并发 drain 放大 provider/worker 压力。

## 范围

- `DaemonA2A.tick`/drain：有界并发，而不是全局 single-flight；每个 entry 的
  provider handoff 不阻塞其他 entry。
- per-(thread, agent) tracker slot：同 agent 顺序、不同 agent 并行。
- capacity/backpressure：并发上界、worker pool、queue cap；失败收敛按 0007/0016。
- queue/live 读模型：等待 vs running 的投影准确。
- 回归 F043 AC-2。

## 非目标

- 不改 routeParallel/routeSerial 的 context/ownership（F044）。
- 不改 multi-mention aggregate/callback（F045）。
- 不改前端气泡/汇总卡（F047）。
- 不引入 task/run/custody 脚手架。

## 验收

- [ ] AC-1：agent A 长 turn 运行中，operator @agent B 的独立 entry 在 A 结束前启动并完成。
- [ ] AC-2：同一 agent 的后续 entry 仍按序等待；不同 agent 可并行。
- [ ] AC-3：queue/live 读模型只显示真实等待；长 turn 与 queued 不混淆。
- [ ] AC-4：并发有上界/backpressure；worker/provider 压力不超过配置。
- [ ] AC-5：F043 AC-2 回归；tests/typecheck/review 绿。

## 证据

- 0007 §3.2 candidate selection、§3.9 recovery、drain 语义。
- 0019 §6 端到端 as-built、F043 live 时间线（D 60s turn / C probe 169ms）。
- `docs/reports/2026-11-27-a2a-parallel-investigation.md`：Q4 根因。

## 风险 / 回滚

- 并发 bug/claim 竞争；用 per-agent slot + 并发上界 + 压力测试覆盖。
- 不允许用全局 single-flight 换简单；那会回退 F043 Q4。
- 回滚：revert feature 分支；live 切换需 operator 授权。

[宪宪/deepseek-flash🐾]
