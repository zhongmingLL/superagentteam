# @superagentteam/daemon

SuperAgentTeam A2A v1 daemon: one thread-first runtime backed by
`<dataDir>/f018.db`, an append-only boot ledger, a single-writer fence,
loopback `/health`, and `requested → ready → stopping → stopped/failed`.

```ts
import { startDaemon } from "@superagentteam/daemon";

const daemon = await startDaemon({
  installationRoot: "/path/to/superagentteam",
  runningRevision: "abc123",
  services: ["api"],
});
daemon.markReady();
console.log(daemon.healthUrl);
await daemon.stop();
```

`startDaemon` starts the A2A control plane by default. `a2aControlPlane: false`
keeps the health/state surface only for tests. The legacy task-first
`controlPlane` option and `--engine legacy` are retired; their runtime files
were deleted in F032.2 and remain recoverable only from the
`archive/task-first-v1` tag.

The daemon never reports ready before `markReady`, and `markReady` fails closed
if a declared service is missing or an undeclared one is reported.

## Operator surfaces

- CLI: `superagentteam auth`, `thread`, `daemon`, `memory`.
- Hub API: A2A threads/messages/queue/invocations/events/agents/accounts.
- Data: A2A v1 tables in `f018.db`; memory uses `memory.db`; daemon state uses
  `daemon-state.json` + `boot-ledger.jsonl`.

Task-first CLI commands, control stores, eval/policy/review/merge/gate modules,
and their tests were removed with the runtime. Historical design notes live
under `docs/architecture/0006-task-first-legacy.md` and `docs/legacy/task-first/`.
