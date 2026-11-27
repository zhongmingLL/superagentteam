import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { defaultHubOrigin } from "../src/cli/runtime.ts";
import { writeRuntimeState } from "../src/infrastructure/supervisor/state.ts";
import type { RuntimeStateFile } from "../src/infrastructure/supervisor/types.ts";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "sat-cli-runtime-"));
	dirs.push(dir);
	return dir;
}

function writeStatusState(dataDir: string): void {
	const state: RuntimeStateFile = {
		schemaVersion: 1,
		worktree: "/tmp/runtime-worktree",
		head: "a".repeat(40),
		dataDir,
		webPort: 3005,
		daemonPort: 3014,
		hubOrigin: "http://localhost:3005",
		envFile: null,
		state: "running",
		daemon: { pid: 999_999, startedAt: "start-1", command: "daemon" },
		web: { pid: 999_998, startedAt: "start-2", command: "web" },
		daemonBootId: "boot-1",
		startedAt: "2026-11-25T00:00:00.000Z",
		updatedAt: "2026-11-25T00:00:00.000Z",
	};
	writeRuntimeState(dataDir, state);
}

describe("CLI runtime surface", () => {
	it("advertises the runtime command", () => {
		const text = execFileSync(process.execPath, [CLI, "--help"], { encoding: "utf8" });
		expect(text).toContain("runtime <start|status|end|restart>");
		expect(text).toContain("--env-file");
	});

	it("reports not_started before the first start", () => {
		const dataDir = tempDir();
		const result = spawnSync(process.execPath, [CLI, "--data-dir", dataDir, "runtime", "status", "--json"], {
			encoding: "utf8",
		});
		expect(result.status).toBe(0);
		const body = JSON.parse(result.stdout.trim()) as { state: string };
		expect(body).toMatchObject({ state: "not_started" });
	});

	it("treats end without state as a no-op", () => {
		const dataDir = tempDir();
		const result = spawnSync(process.execPath, [CLI, "--data-dir", dataDir, "runtime", "end", "--json"], {
			encoding: "utf8",
		});
		expect(result.status).toBe(0);
		const body = JSON.parse(result.stdout.trim()) as { changed: boolean; state: string };
		expect(body).toMatchObject({ changed: false, state: "not_started" });
	});

	it("defaults the hub origin to the web entry, not the retired 3103 proxy", () => {
		expect(defaultHubOrigin(3005)).toBe("http://localhost:3005");
		expect(defaultHubOrigin(3007)).toBe("http://localhost:3007");
	});

	it("prints the public entry and allowed origins, without the retired Windows proxy", () => {
		const dataDir = tempDir();
		writeStatusState(dataDir);
		const result = spawnSync(process.execPath, [CLI, "--data-dir", dataDir, "runtime", "status"], {
			encoding: "utf8",
		});
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("public: http://localhost:3005");
		expect(result.stdout).toContain("origins: http://localhost:3005 (+ loopback aliases)");
		expect(result.stdout).not.toContain("windows:");
	});

	it("fails --check-write when the runtime is not running", () => {
		const dataDir = tempDir();
		writeStatusState(dataDir);
		const result = spawnSync(process.execPath, [CLI, "--data-dir", dataDir, "runtime", "status", "--check-write"], {
			encoding: "utf8",
		});
		expect(result.status).toBe(1);
		expect(result.stdout).toContain("write path: FAILED");
	});
});
