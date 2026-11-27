---
title: "F044a route ownership slice — implementation report"
doc_kind: report
status: done
created: 2026-11-27
updated: 2026-11-27
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
related_features: [superagentteam/F044, superagentteam/F043, superagentteam/F046]
---

# F044a route ownership slice — implementation report

## Scope

F044a is the first slice of F044 (`docs/features/F044-a2a-route-layer.md`):
restore the route layer and move T2 ownership out of `RunAgentTurn`. Phase B
stays in `QueueProcessor` until F044b; this report does not claim F044 complete.

Branch: `feat/f044-route-ownership`, base `superagentteam-work` @ `c4d1c13a`;
code commit `8c144a894`; E2E/docs commit `e59f8065d`.

## Delivered

- New `packages/superagentteam-daemon/src/domains/agent/route.ts`:
  - `AgentRouter.routeAgents(targets, "parallel" | "serial")`.
  - `routeParallel`: synchronous context assembly for every target before any
    `TurnRunner` starts; per-target assembly/run errors isolated and returned.
  - `routeSerial`: worklist loop with `priorResponses`, context assembly, T2
    commit, and carrier release for single-target operator/A2A hops.
  - `createContextAssembler`: queue-source `upToSeq` + `includeSourceMessageId`
    snapshot, prompt built from the same window, serial prior responses appended
    after the thread snapshot.
- `RunAgentTurn` now implements `TurnRunner`:
  - receives the route-assembled `TurnContext` (no per-turn `loadHistory`);
  - returns `AgentTurnCompletion` (`AgentTurnResult` + `release()`);
  - no longer constructs or calls `RouteResponseCommitter`;
  - T1 remains its only settlement write.
- `RouteResponseCommitter.commit` accepts the route's `AgentTurnResult` shape;
  `content` is now an optional fallback because the durable draft is canonical.
- `QueueProcessor`:
  - `dispatchTarget` replaced by injected `router: AgentRouter`;
  - one route call per Phase-B batch (`parallel` for >1 target, `serial` for 1);
  - provider-phase route errors flow back into the existing per-target
    convergence (turn/attempt/credential/R + pending target restore);
  - T3 aggregate remains processor-owned.
- Composition root (`domains/a2a/runtime.ts`) wires assembler + runner +
  committer into one `AgentRouter`.

## Evidence

- `NODE_ENV=development npm run build --workspace=@superagentteam/daemon` — passed.
- `NODE_ENV=test ./node_modules/.bin/vitest --run` in `packages/superagentteam-daemon`
  — 77 files passed / 1 skipped; 528 tests passed / 1 skipped.
- New `test/f044-route-ownership.test.ts` — 5 tests:
  - parallel assemblies all contexts before first run;
  - failing target isolated while healthy sibling commits;
  - single-target serial assembles/runs/commits;
  - serial commits before next target assembly and passes prior responses;
  - failed T2 leaves the response for T4 without failing the route.
- F043 AC-1 regression (`f018-r2a-dispatch.test.ts` “fans out all targets …
  concurrently”) passes through the new router.
- T2 integration remains covered by `f018-r2b-worker-stream.test.ts` and
  `f018-r2c-settlement.test.ts`, now driven through `AgentRouter`.
- **Current test-worktree E2E** (operator 2026-11-27 requirement):
  `NODE_ENV=test npx vitest --run test/f037-fullstack-e2e.test.ts` — 2 passed:
  - real daemon + real pi worker + mock provider: A→B `post_message` chain,
    both replies settled, ≥2 parents completed;
  - multi-target operator message `@a1 @b1`: one parent with
    `target_agent_ids=["a1","b1"]`, both replies settled, B's provider prompt
    contains no `A_PARALLEL_REPLY` (batch-barrier isolation).
  - Isolated temp data dir + ephemeral daemon port; no runtime/production data.

## Ownership after F044a

| Layer | Owner |
|---|---|
| target resolution / admission | `OperatorMessageIngress` |
| Phase A + tracker | `QueueProcessor` |
| Phase B (R/turn/credential/draft/retire) | `QueueProcessor` (F044b target: `runAgentTurn`) |
| context assembly + parallel/serial route | `AgentRouter` |
| T1 child terminal | `RunAgentTurn` + `TurnExecutionLifecycle` |
| T2 response commit | `AgentRouter` → `RouteResponseCommitter` |
| carrier release | route calls `AgentTurnCompletion.release()` after T2 |
| T3 parent aggregate | `QueueProcessor` |
| T4 recovery | `ResponseRecoveryService` |

## Remaining F044b / follow-ups

- Move Phase B into `runAgentTurn` / `invokeSingleAgent` and remove the
  `QueueProcessor.processEntry` Phase-B loop; update `QueueProcessorDeps` route
  shape (audit B1/B2) in the same change.
- Extract/explicitly map the `invoke-single-agent` component (audit A5).
- Wire A2A successor admission after durable T2 commit (F046 owns the unified
  successor semantics).
- Update `architecture/0019` route/as-built sections after F044 is fully cut
  over; it currently still describes the pre-F044a inline fan-out.

## Risks / notes

- The route barrier is a setup barrier, not a per-turn filter. A future change
  that moves history assembly back inside `RunAgentTurn` would silently
  reintroduce the F043-style sibling-visible race.
- Route commit failure is swallowed exactly like the previous Turn-local T2:
  `response_pending` is left for T4. The route never fails a turn because T2
  failed.
- `release()` is intentionally route-called after T2; a clean throw before T1
  still releases the worker inside `RunAgentTurn`, preserving the no-leak port
  contract.

[宪宪/deepseek-flash🐾]
