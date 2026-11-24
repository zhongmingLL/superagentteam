import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { RUNTIME_PORT_REGISTRY, validateRuntimePorts } from "./runtime-ports.mjs";

test("default runtime port registry is valid", () => {
	assert.deepEqual(validateRuntimePorts(), { ok: true, errors: [] });
});

test("duplicate web/daemon ports are rejected", () => {
	const result = validateRuntimePorts({
		...RUNTIME_PORT_REGISTRY,
		test: { ...RUNTIME_PORT_REGISTRY.test, web: RUNTIME_PORT_REGISTRY.runtime.web },
	});
	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /test\.web duplicates runtime\.web/);
});

test("reserved Clowder ports are rejected", () => {
	const result = validateRuntimePorts({
		...RUNTIME_PORT_REGISTRY,
		test: { ...RUNTIME_PORT_REGISTRY.test, daemon: 3004 },
	});
	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /reserved port 3004 \(clowder-ai-api\)/);
});

test("out-of-range ports are rejected", () => {
	const result = validateRuntimePorts({
		...RUNTIME_PORT_REGISTRY,
		runtime: { ...RUNTIME_PORT_REGISTRY.runtime, web: 80 },
	});
	assert.equal(result.ok, false);
	assert.match(result.errors.join("\n"), /runtime\.web must be an integer in 1024-65535/);
});

test("CLI defaults stay in sync with the registry", () => {
	const source = readFileSync(
		fileURLToPath(new URL("../../packages/superagentteam-daemon/src/cli/runtime.ts", import.meta.url)),
		"utf8",
	);
	assert.match(source, new RegExp(`DEFAULT_WEB_PORT = ${RUNTIME_PORT_REGISTRY.runtime.web};`));
	assert.match(source, new RegExp(`DEFAULT_DAEMON_PORT = ${RUNTIME_PORT_REGISTRY.runtime.daemon};`));
	assert.match(source, new RegExp(`DEFAULT_WINDOWS_PORT = ${RUNTIME_PORT_REGISTRY.runtime.windows};`));
});
