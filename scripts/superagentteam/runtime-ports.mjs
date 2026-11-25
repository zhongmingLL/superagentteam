#!/usr/bin/env node
import { pathToFileURL } from "node:url";

/**
 * F033 local runtime port registry. This is the single source of truth for the
 * runtime/test port roles; the CLI defaults are checked against it by
 * runtime-ports.test.mjs so the two cannot drift silently.
 */
export const RUNTIME_PORT_REGISTRY = {
	runtime: { web: 3005, daemon: 3014 },
	test: { web: 3007, daemon: 3016 },
	reserved: [
		{ port: 3003, owner: "clowder-ai-web" },
		{ port: 3004, owner: "clowder-ai-api" },
	],
};

function validPort(port) {
	return Number.isInteger(port) && port >= 1024 && port <= 65535;
}

export function validateRuntimePorts(registry = RUNTIME_PORT_REGISTRY) {
	const errors = [];
	const seen = new Map();
	const roles = [
		["runtime.web", registry.runtime?.web],
		["runtime.daemon", registry.runtime?.daemon],
		["test.web", registry.test?.web],
		["test.daemon", registry.test?.daemon],
	];
	for (const [role, port] of roles) {
		if (!validPort(port)) {
			errors.push(`${role} must be an integer in 1024-65535`);
			continue;
		}
		if (seen.has(port)) errors.push(`${role} duplicates ${seen.get(port)} on port ${port}`);
		else seen.set(port, role);
	}
	const reserved = new Map((registry.reserved ?? []).map((entry) => [entry.port, entry.owner]));
	for (const [role, port] of roles) {
		if (reserved.has(port)) errors.push(`${role} uses reserved port ${port} (${reserved.get(port)})`);
	}
	return { ok: errors.length === 0, errors };
}

const invokedAsScript = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
	const result = validateRuntimePorts();
	if (!result.ok) {
		process.stderr.write(`runtime port registry is invalid:\n${result.errors.map((error) => `- ${error}`).join("\n")}\n`);
		process.exitCode = 1;
	} else {
		process.stdout.write("runtime port registry OK: runtime 3005/3014; test 3007/3016; reserved 3003/3004\n");
	}
}
