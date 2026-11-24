---
title: "Task-first legacy index"
doc_kind: architecture
status: legacy
created: 2026-11-19
related_features: [codeteam/F018]
---

# Task-first legacy (frozen)

> **F032.2 archive（2026-11-24）：** the task-first runtime and all old-path
> shims were deleted from main. This directory is a non-normative historical
> index only; recover code from tag `archive/task-first-v1`
> (`dd29e1cabbcf7907ee001c6c9440164697d0747e`). Current v1 truth is
> `docs/architecture/0005-thread-first-runtime.md`.

Historical source of truth for what was frozen: `docs/architecture/0006-task-first-legacy.md`.
This index records the physical relocation done in F018 R1-0 and the F032.2 deletion.

## Code layout (historical; files deleted)

All task-first implementation used to live under
`packages/superagentteam-daemon/src/legacy/task-first/`. F032.2 deleted that
directory, its path shims, control stores, and legacy-only tests. The historical
shim coverage was
deliberately two-tier: the top-level domains and `a2a/` keep **per-file
re-export shims** at their old paths; the moved control stores expose a
**single deprecated barrel** (`control/stores/types.ts`) plus the
`control/migrations/` index barrel and the `control/read-models.ts` shim —
the 15 moved store files have no per-file shims because their remaining
consumers were rewritten to the new locations (store VALUE access goes
through `control/store.ts`, which is allowlisted). Shims carry no logic and
are removed in R5.

| Old path (historical) | Relocated location (deleted) | Removal |
|---|---|---|
| `src/{dispatch,scheduling,review,merge,gates,sop,managed-work,deployment-wait,custody}/` | same name under `src/legacy/task-first/` | R5 |
| `src/a2a/*` (task-bound impl incl. legacy handler class) | `src/legacy/task-first/a2a/` | R2/R3 (v1 surface rebuild) |
| `src/control/stores/` — 15 task-bound stores + `types.ts` | `src/legacy/task-first/control/stores/` | R5 (types barrel at old path is `@deprecated`) |
| `src/control/read-models.ts` | `src/legacy/task-first/control/read-models.ts` | R5 |
| `src/control/migrations/` (task-first table DDL) | `src/legacy/task-first/control/migrations/` | R5 (applied by legacy `control/database.ts`, allowlisted owner R5); the F018 v1 migration harness lands in `src/infrastructure/db/migrations/` in R1-a |

Shared modules that were not moved in R1-0 (`workers/`, `auth/`, `policy/`,
remaining `control/stores/`) were split or deleted in F032.2; only the v1
pieces (`workers/rpc-client.ts`, `workers/a2a-extension.ts`, v1 auth) remain.

## Enforcement

`scripts/check-legacy-boundary.mjs` (wired into `npm run check` and the CI
SuperAgentTeam lane):

- non-allowlisted files under `src/` (outside `legacy/` and shims) must not
  import `legacy/task-first/`, **any** old-path shim (top-level dirs,
  `a2a/<legacy-file>.ts`, `control/stores/types.ts` barrel,
  `control/read-models.ts`, `control/migrations/` barrel);
- `packages/superagentteam-shared/src` (v1 type home) has **zero** tolerance:
  any legacy import fails, no allowlist possible;
- v1 runtime paths (`src/domains/`) can never be allowlisted and must not
  reference retired tool names (`a2a_send`, `handoff_*`) or frozen tables
  (`tasks`, `handoffs`, `custody_events`, `budgets`, `reviews`, `merges`);
- stale allowlist entries fail, so the list only shrinks.

The baseline allowlist lives in `scripts/legacy-boundary-allowlist.json` and is
now empty (`{}`). Machine-enforced: unlisted imports, stale entries,
shared-package and `src/domains/` imports all fail. The guard also runs a
negative self-test that proves it still detects reintroduced legacy paths,
retired tools (`a2a_send`, `handoff_*`), and frozen tables (`tasks`,
`handoffs`, `custody_events`, `budgets`, `reviews`, `merges`).

## Docs layout

Pure task-first feature docs moved **flat** into this directory (old paths
keep `status: moved` stubs): `F006-w3-independent-review.md`,
`F007-w4-sop-gates.md`, `F008-w5a-a2a-dispatch-custody.md`,
`F010-w5c-scheduling-resources.md`, `F011-w5d-runtime-lifecycle-managed-work.md`.

Mixed/still-referenced docs (F004/F005/F015/F016 families, W-numbered plans,
`0001`-`0018` architecture docs) stay in place with `legacy-frozen` /
`[historical]` notes per `0006`.

## Rules

- New v1 code must not import anything from `legacy/task-first/`, the old
  shims, or the `control/migrations` barrel.
- Legacy type barrel `control/stores/types.ts` is `@deprecated`; v1 types
  come from `@superagentteam/shared/types` only. No file may depend on both
  generations.
- F032.2 deleted the frozen runtime; nothing may be reintroduced into v1 paths.
