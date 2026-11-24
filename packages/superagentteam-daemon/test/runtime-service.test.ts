import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProcessIdentityProvider } from "../src/lifecycle/process.ts";
import type { ProcessSignalSender } from "../src/lifecycle/signal.ts";
import type { ProcessIdentity } from "../src/lifecycle/types.ts";
import { RuntimeService } from "../src/runtime/service.ts";
import { readRuntimeState } from "../src/runtime/state.ts";
import type { RuntimeServiceOptions, RuntimeSpawner, RuntimeStartOptions } from "../src/runtime/types.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "sat-runtime-service-"));
	dirs.push(dir);
	return dir;
}

class World {
	readonly identities = new Map<number, ProcessIdentity>();
	readonly alive = new Set<number>();
	readonly signals: Array<{ pid: number; signal: string }> = [];
	private nextPid = 100;
	spawnCount = 0;

	add(command: string): number {
		const pid = this.nextPid++;
		this.identities.set(pid, { pid, startedAt: `start-${pid}`, command });
		this.alive.add(pid);
		return pid;
	}

	readonly provider: ProcessIdentityProvider = {
		read: (pid: number) => (this.alive.has(pid) ? (this.identities.get(pid) ?? null) : null),
		isAlive: (pid: number) => this.alive.has(pid),
		descendants: () => [],
	};

	readonly sender: ProcessSignalSender = {
		send: (pid: number, signal: "SIGTERM") => {
			this.signals.push({ pid, signal });
			this.alive.delete(pid);
		},
	};

	readonly spawner: RuntimeSpawner = {
		spawnDaemon: () => {
			this.spawnCount += 1;
			return { pid: this.add("daemon") };
		},
		spawnWeb: () => {
			this.spawnCount += 1;
			return { pid: this.add("web") };
		},
	};
}

interface Harness {
	readonly world: World;
	readonly service: RuntimeService;
	readonly options: RuntimeStartOptions;
	readonly daemonHealthy: { value: boolean };
	readonly webHealthy: { value: boolean };
	readonly portsFree: { value: boolean };
}

function harness(dataDir: string, overrides: Partial<RuntimeServiceOptions> = {}): Harness {
	const world = new World();
	const daemonHealthy = { value: true };
	const webHealthy = { value: true };
	const portsFree = { value: true };
	const service = new RuntimeService({
		dataDir,
		spawner: world.spawner,
		processProvider: world.provider,
		signalSender: world.sender,
		health: {
			daemon: async () => daemonHealthy.value,
			web: async () => webHealthy.value,
		},
		isPortFree: async () => portsFree.value,
		readDaemonBootId: () => "boot-1",
		clock: () => new Date("2026-11-25T00:00:00.000Z"),
		sleep: async () => {},
		startTimeoutMs: 5,
		endGraceMs: 0,
		...overrides,
	});
	const options: RuntimeStartOptions = {
		worktree: "/tmp/runtime-worktree",
		head: "a".repeat(40),
		dataDir,
		webPort: 3008,
		daemonPort: 3017,
		hubOrigin: "http://localhost:3103",
		windowsPort: 3103,
		envFile: null,
		env: { KIMI_API_KEY: "secret" },
		requiredEnvNames: ["KIMI_API_KEY"],
	};
	return { world, service, options, daemonHealthy, webHealthy, portsFree };
}

describe("RuntimeService", () => {
	it("starts a stack, writes running state and is idempotent", async () => {
		const dataDir = tempDir();
		const h = harness(dataDir);
		const first = await h.service.start(h.options);
		expect(first.started).toBe(true);
		expect(first.status.state).toBe("running");
		expect(h.world.spawnCount).toBe(2);
		expect(readRuntimeState(dataDir)?.state).toBe("running");

		const second = await h.service.start(h.options);
		expect(second.started).toBe(false);
		expect(h.world.spawnCount).toBe(2);
	});

	it("fails closed when a required environment name is missing", async () => {
		const dataDir = tempDir();
		const h = harness(dataDir);
		await expect(
			h.service.start({ ...h.options, env: {}, requiredEnvNames: ["KIMI_API_KEY"] }),
		).rejects.toMatchObject({
			code: "runtime_env_missing",
		});
		expect(h.world.spawnCount).toBe(0);
	});

	it("fails closed when a runtime port is already in use", async () => {
		const dataDir = tempDir();
		const h = harness(dataDir);
		h.portsFree.value = false;
		await expect(h.service.start(h.options)).rejects.toMatchObject({ code: "runtime_port_in_use" });
		expect(h.world.spawnCount).toBe(0);
	});

	it("cleans up and records failed state when health never becomes ready", async () => {
		const dataDir = tempDir();
		const h = harness(dataDir);
		h.daemonHealthy.value = false;
		await expect(h.service.start(h.options)).rejects.toMatchObject({ code: "runtime_daemon_unhealthy" });
		const state = readRuntimeState(dataDir);
		expect(state?.state).toBe("failed");
		expect(state?.daemon).toBeNull();
		expect(state?.web).toBeNull();
		expect(h.world.alive.size).toBe(0);
	});

	it("reports stale when the recorded processes are gone", async () => {
		const dataDir = tempDir();
		const h = harness(dataDir);
		await h.service.start(h.options);
		h.world.alive.clear();
		const report = await h.service.status();
		expect(report.state).toBe("stale");
	});

	it("ends identity-verified processes and is idempotent", async () => {
		const dataDir = tempDir();
		const h = harness(dataDir);
		await h.service.start(h.options);
		const first = await h.service.end();
		expect(first.state).toBe("stopped");
		expect(first.signaled).toHaveLength(2);
		expect(h.world.alive.size).toBe(0);
		expect(readRuntimeState(dataDir)?.state).toBe("stopped");

		const second = await h.service.end();
		expect(second.changed).toBe(false);
		expect(second.state).toBe("stopped");
	});

	it("refuses to signal a reused pid and reports degraded", async () => {
		const dataDir = tempDir();
		const h = harness(dataDir);
		await h.service.start(h.options);
		const state = readRuntimeState(dataDir);
		const daemon = state?.daemon;
		expect(daemon).not.toBeNull();
		h.world.identities.set(daemon!.pid, { ...daemon!, startedAt: "reused" });
		const report = await h.service.status();
		expect(report.warnings?.join(" ")).toContain(`daemon pid ${daemon!.pid}`);
		const result = await h.service.end();
		expect(result.state).toBe("degraded");
		expect(result.mismatched).toContain(daemon!.pid);
		expect(h.world.signals.some((entry) => entry.pid === daemon!.pid)).toBe(false);
	});
});
