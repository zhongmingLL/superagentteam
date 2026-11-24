#!/usr/bin/env node
// Compatibility wrapper for F025-era docs/scripts. The official runtime launcher
// is scripts/superagentteam/runtime-daemon.mjs, spawned by `superagentteam runtime start`.
process.env.SUPERAGENTTEAM_RUNNING_REVISION ??= "f025-e2e";
await import("./superagentteam/runtime-daemon.mjs");
