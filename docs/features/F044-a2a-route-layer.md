---
feature_ids: [superagentteam/F044]
related_features: [superagentteam/F018, superagentteam/F043, superagentteam/F045, superagentteam/F046, superagentteam/F048]
title: "F044: A2A route layer restoration"
status: planned
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: []
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-27
updated: 2026-11-27
source_decision: "operator 2026-11-27: F043 是架构偏移上的补丁；按 0007/0019 的 Clowder 整体设计恢复 route 层；单 target 也要保留 route 前后处理"
---

# F044: A2A route layer restoration

> **先读（强制）**：
> - [`0007-a2a-runtime-chain.md`](../architecture/0007-a2a-runtime-chain.md)：target contract。
> - [`0019-a2a-runtime-chain-as-built.md`](../architecture/0019-a2a-runtime-chain-as-built.md)：当前 as-built，原 0008 as-built。
> - [`0050-a2a-runtime-alignment.md`](../plans/0050-a2a-runtime-alignment.md)：本计划。
>
> 本 feature 只实现计划切片；不得新增与 0007 冲突的第二套调度。发现必须偏离时，
> 先更新计划/0019 并拿到 operator/owner 决定。

## Why

0019 R1–R4 记录了核心偏差：0007 target 的 `AgentRouter`/`routeAgents`/
`routeParallel`/`routeSerial`/`RouteResponseCommitter` 没有实现，F043 把多 target
并发、context 快照和 T2 分散补在 `QueueProcessor`/`RunAgentTurn` 上。operator 2026-11-27
明确：F043 是缝补，回到 Clowder 整体设计。

Clowder 的并行 route 在批次边界先完成所有 target 的 context 装配，再启动任何
provider invocation；因此同批 target 不会看到彼此回答。`routeSerial` 即使只有一个
target，也保留 worklist、context、response commit、A2A successor、cleanup。

## 用户结果

- multi-target 从同一触发边界开始，任何 target 都看不到同批 sibling 的回答。
- 单 target operator message 仍经过 routeSerial 的前后处理，A2A successor 只在
  response durable 后 admission。
- T2（R terminal/draft delete/attempt settled）由 route 的
  `RouteResponseCommitter` 统一提交；不再由 `RunAgentTurn` 或 QueueProcessor 双写。
- F043 AC-1 在 holistic 实现下继续成立。

## 范围

- 新增 `AgentRouter` / `routeAgents(mode)`，作为 QueueProcessor 与 per-target
  execution 之间的唯一 route。
- `routeParallel`：批次 setup 阶段完成所有 target context 装配；再启动 streams；
  per-target 错误隔离；T2 commit 由 route 调用。
- `routeSerial`：单 target operator/A2A hop 的 route；即使只有一个 target 也保留
  worklist、context、T2、A2A successor、cleanup。多 target operator message 恒走
  `routeParallel`；`priorResponses` 按 0007 实现，供 route 契约/多 target 测试与未来
  worklist 使用，不作为 v1 多 target 产品路径。
- `RouteResponseCommitter`：T2 owner。
- Phase B/T1 ownership 按 0007：Phase B + T1 在 `runAgentTurn`/`invokeSingleAgent`；
  QueueProcessor 保留 Phase A/T3。
- 删除 `QueueProcessor.processEntry` 的 inline fan-out 与 `RunAgentTurn` 内的 T2 写路径。
- 回归：F043 AC-1（并发 + no sibling visibility）。

## 非目标

- 不改 multi-mention orchestrator 的 aggregate/callback/status（F045）。
- 不改 daemon 并发 drain（F046）。
- 不改前端私有气泡/汇总卡（F047）。
- 不引入 task/run/custody 脚手架，不做双 scheduler live 并存。

## 验收

- [ ] AC-1：`routeParallel` 先完成同批全部 target context 装配，再启动任何 invocation；
  一个 target 先完成并写入 response 时，sibling 的 prompt 不包含它。
- [ ] AC-2：单 target `routeSerial` 仍执行 worklist/context/T2/A2A successor/cleanup
  前后处理；`priorResponses` 契约在 route 测试中覆盖；多 target operator message
  走 `routeParallel`，不误用 serial 产品路径。
- [ ] AC-3：T2 只由 route/`RouteResponseCommitter` 写；`RunAgentTurn` 不写 R terminal/
  draft delete；QueueProcessor 只做 T3 aggregate。
- [ ] AC-4：A2A successor 只在 response durable commit 后 admission。
- [ ] AC-5：F043 AC-1 回归通过；T1–T4 ownership matrix 通过。
- [ ] AC-6：daemon/web tests、typecheck、doc-index 绿；非作者 review 覆盖最终 HEAD。

## 证据

- 0007 §0/§2/§3.2/§3.5.1/§3.9/§9.1：route ownership、context、T2/T3、验收。
- 0019 §3/§5/§7/§8：as-built 偏差与整改决策。
- `docs/reuse/dispatch.md`：R0 直接复用契约；P1 风险明确“只复用 Queue、重写
  routeSerial/routeParallel 会丢掉 A2A chain/worklist/response 聚合”。
- Clowder 参考实现的 `route-parallel` setup barrier、`route-serial` worklist/commit
  语义（本地只读参考，不写进产品路径）。
- F043 `docs/reports/2026-11-27-a2a-parallel-investigation.md` 的四问题证据。

## 风险 / 回滚

- 核心执行路径重构；分支内完成 parity，不 live 半切。
- T2 ownership 迁移最易双写/漏写；F044 单独矩阵验证，禁止保留旧 T2 写路径。
- 回滚：revert feature 分支；不破坏 schema；live 切换需 operator 授权。

[宪宪/deepseek-flash🐾]
