import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	readRuntimeState,
	resolveRuntimeStatePath,
	writeRuntimeState,
} from "../src/infrastructure/supervisor/state.ts";
import type { RuntimeStateFile } from "../src/infrastructure/supervisor/types.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "sat-runtime-state-"));
	dirs.push(dir);
	return dir;
}

const state: RuntimeStateFile = {
	schemaVersion: 1,
	worktree: "/tmp/worktree",
	head: "a".repeat(40),
	dataDir: "/tmp/data",
	webPort: 3005,
	daemonPort: 3014,
	hubOrigin: "http://localhost:3005",
	envFile: null,
	state: "running",
	daemon: { pid: 100, startedAt: "start-100", command: "daemon" },
	web: { pid: 101, startedAt: "start-101", command: "web" },
	daemonBootId: "boot-1",
	startedAt: "2026-11-25T00:00:00.000Z",
	updatedAt: "2026-11-25T00:00:00.000Z",
};

describe("runtime state", () => {
	it("round-trips the managed state with owner-only permissions", () => {
		const dir = tempDir();
		const file = writeRuntimeState(dir, state);
		expect(file).toBe(resolveRuntimeStatePath(dir));
		expect(readRuntimeState(dir)).toEqual(state);
		expect(statSync(file).mode & 0o777).toBe(0o600);
	});

	it("returns null when no state exists", () => {
		expect(readRuntimeState(tempDir())).toBeNull();
	});

	it("fails closed on invalid state JSON", () => {
		const dir = tempDir();
		writeFileSync(resolveRuntimeStatePath(dir), "{not-json");
		expect(() => readRuntimeState(dir)).toThrowError(expect.objectContaining({ code: "runtime_state_invalid" }));
	});
});
