import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const repoRoot = resolve(process.cwd());
const srcRoot = join(repoRoot, "packages", "superagentteam-daemon", "src");
const failures = [];

const forbiddenTopLevel = ["auth", "runtime", "workers", "control", "lifecycle"];
for (const name of forbiddenTopLevel) {
	if (existsSync(join(srcRoot, name)) && readdirSync(join(srcRoot, name)).length > 0) {
		failures.push(`forbidden legacy top-level src/${name}/ (F051: use app/infrastructure/pi-worker/shared)`);
	}
}
if (existsSync(join(srcRoot, "domains", "events")) && readdirSync(join(srcRoot, "domains", "events")).length > 0) {
	failures.push("forbidden src/domains/events/ (F051: infrastructure/events)");
}
if (existsSync(join(srcRoot, "domains", "a2a", "runtime.ts"))) {
	failures.push("forbidden src/domains/a2a/runtime.ts (F051: app/a2a-runtime.ts)");
}
for (const name of [
	"agent",
	"history",
	"message",
	"thread",
	"session",
	"auth",
	"account",
	"worker",
	"response",
	"rich-block",
]) {
	const dir = join(srcRoot, "domains", name);
	if (existsSync(dir) && readdirSync(dir).length > 0) {
		failures.push(`forbidden legacy src/domains/${name}/ (F051b: use the target domain name)`);
	}
}
if (existsSync(join(srcRoot, "domains", "invocation", "store.ts"))) {
	failures.push("forbidden src/domains/invocation/store.ts (F051b: split into records/turns/attempts)");
}
if (existsSync(join(srcRoot, "domains", "multi-mention"))) {
	failures.push("forbidden src/domains/multi-mention/ (F051b: a2a/multi-mention)");
}

for (const required of [
	"app/daemon.ts",
	"app/daemon-a2a.ts",
	"app/a2a-runtime.ts",
	"pi-worker/a2a-extension.ts",
	"infrastructure/events/bus.ts",
	"infrastructure/process/service.ts",
	"infrastructure/supervisor/service.ts",
	"shared/control/errors.ts",
	"domains/a2a/ingress/router.ts",
	"domains/a2a/tools/tool-service.ts",
	"domains/a2a/routing/route.ts",
	"domains/a2a/multi-mention/orchestrator.ts",
	"domains/a2a/multi-mention/store.ts",
	"domains/agents/registry.ts",
	"domains/execution/turn.ts",
	"domains/context/assembler.ts",
	"domains/messages/store.ts",
	"domains/threads/store.ts",
	"domains/sessions/store.ts",
	"domains/credentials/store.ts",
	"domains/accounts/store.ts",
	"domains/workers/pool.ts",
	"domains/streaming/store.ts",
	"domains/rich-blocks/service.ts",
	"domains/queue/ledger/store.ts",
	"domains/queue/processor/index.ts",
	"domains/queue/tracker/index.ts",
	"domains/invocation/records/store.ts",
	"domains/invocation/turns/store.ts",
	"domains/invocation/attempts/store.ts",
	"domains/invocation/settlement/index.ts",
	"domains/invocation/aggregate/aggregate.ts",
	"domains/invocation/recovery/index.ts",
	"domains/invocation/read-models/live.ts",
]) {
	if (!existsSync(join(srcRoot, required))) failures.push(`missing required layout file src/${required}`);
}

function walk(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) out.push(...walk(path));
		else if (path.endsWith(".ts")) out.push(path);
	}
	return out;
}

for (const file of walk(join(srcRoot, "domains"))) {
	const text = readFileSync(file, "utf8");
	if (/from\s+["'][^"']*\/app\//.test(text)) {
		failures.push(`${relative(repoRoot, file)}: domain must not import app/`);
	}
}

if (failures.length > 0) {
	process.stderr.write(`daemon layout check failed:\n- ${failures.join("\n- ")}\n`);
	process.exit(1);
}
process.stdout.write("daemon layout check passed\n");
