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

for (const required of [
	"app/daemon.ts",
	"app/daemon-a2a.ts",
	"app/a2a-runtime.ts",
	"pi-worker/a2a-extension.ts",
	"infrastructure/events/bus.ts",
	"infrastructure/process/service.ts",
	"infrastructure/supervisor/service.ts",
	"shared/control/errors.ts",
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
