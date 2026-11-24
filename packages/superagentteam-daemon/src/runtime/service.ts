import { ControlError } from "../control/errors.ts";
import type { ProcessIdentity } from "../lifecycle/types.ts";
import { readRuntimeState, resolveRuntimeStatePath, writeRuntimeState } from "./state.ts";
import type {
	RuntimeEndResult,
	RuntimeProcessRecord,
	RuntimeServiceOptions,
	RuntimeStartOptions,
	RuntimeStartResult,
	RuntimeStateFile,
	RuntimeStatusProcess,
	RuntimeStatusReport,
} from "./types.ts";
import { toProcessRecord } from "./types.ts";

const DEFAULT_START_TIMEOUT_MS = 20_000;
const DEFAULT_END_GRACE_MS = 8_000;
const POLL_INTERVAL_MS = 200;

function nowIso(clock: () => Date): string {
	return clock().toISOString();
}

function matches(expected: RuntimeProcessRecord | null, actual: ProcessIdentity | null): boolean {
	return (
		expected !== null &&
		actual !== null &&
		expected.pid === actual.pid &&
		expected.startedAt === actual.startedAt &&
		expected.command === actual.command
	);
}

export class RuntimeService {
	private readonly options: RuntimeServiceOptions;
	private readonly clock: () => Date;
	private readonly sleep: (ms: number) => Promise<void>;

	constructor(options: RuntimeServiceOptions) {
		this.options = options;
		this.clock = options.clock ?? (() => new Date());
		this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
	}

	async start(input: RuntimeStartOptions): Promise<RuntimeStartResult> {
		const existing = readRuntimeState(input.dataDir);
		if (existing) {
			const current = await this.status();
			if (current.state === "running") return { started: false, status: current };
			if (current.state === "degraded") {
				throw new ControlError(
					"runtime_already_running",
					`runtime is already partially running in ${existing.worktree}; run \`superagentteam runtime end\` first`,
				);
			}
		}

		const missing = input.requiredEnvNames.filter((name) => !input.env[name]);
		if (missing.length > 0) {
			throw new ControlError(
				"runtime_env_missing",
				`missing required environment: ${missing.join(", ")}; add them to ${input.envFile ?? "the runtime environment"}`,
			);
		}

		const webFree = await this.options.isPortFree(input.webPort);
		const daemonFree = await this.options.isPortFree(input.daemonPort);
		if (!webFree || !daemonFree) {
			const busy = [!webFree ? `web ${input.webPort}` : null, !daemonFree ? `daemon ${input.daemonPort}` : null]
				.filter((value): value is string => value !== null)
				.join(", ");
			throw new ControlError("runtime_port_in_use", `runtime port is already in use: ${busy}`);
		}

		const startedAt = nowIso(this.clock);
		let state: RuntimeStateFile = {
			schemaVersion: 1,
			worktree: input.worktree,
			head: input.head,
			dataDir: input.dataDir,
			webPort: input.webPort,
			daemonPort: input.daemonPort,
			hubOrigin: input.hubOrigin,
			windowsPort: input.windowsPort,
			envFile: input.envFile,
			state: "starting",
			daemon: null,
			web: null,
			daemonBootId: null,
			startedAt,
			updatedAt: startedAt,
		};
		writeRuntimeState(input.dataDir, state);

		let daemonIdentity: ProcessIdentity | null = null;
		let webIdentity: ProcessIdentity | null = null;
		try {
			const daemonPid = this.options.spawner.spawnDaemon({
				worktree: input.worktree,
				dataDir: input.dataDir,
				port: input.daemonPort,
				hubOrigin: input.hubOrigin,
				revision: input.head,
				env: input.env,
			}).pid;
			daemonIdentity = this.options.processProvider.read(daemonPid);
			if (!daemonIdentity) {
				throw new ControlError(
					"runtime_process_identity_unavailable",
					`cannot read daemon identity for pid ${daemonPid}`,
				);
			}
			state = { ...state, daemon: toProcessRecord(daemonIdentity) };
			writeRuntimeState(input.dataDir, state);

			const webPid = this.options.spawner.spawnWeb({
				worktree: input.worktree,
				webPort: input.webPort,
				daemonPort: input.daemonPort,
				env: input.env,
			}).pid;
			webIdentity = this.options.processProvider.read(webPid);
			if (!webIdentity) {
				throw new ControlError(
					"runtime_process_identity_unavailable",
					`cannot read web identity for pid ${webPid}`,
				);
			}
			state = { ...state, web: toProcessRecord(webIdentity) };
			writeRuntimeState(input.dataDir, state);

			const daemonReady = await this.waitFor(() => this.options.health.daemon(input.daemonPort));
			if (!daemonReady)
				throw new ControlError("runtime_daemon_unhealthy", `daemon did not become ready on ${input.daemonPort}`);
			const webReady = await this.waitFor(() => this.options.health.web(input.webPort));
			if (!webReady) throw new ControlError("runtime_web_unhealthy", `web did not become ready on ${input.webPort}`);

			const daemonBootId = this.options.readDaemonBootId?.(input.dataDir) ?? null;
			state = { ...state, state: "running", daemonBootId, updatedAt: nowIso(this.clock) };
			writeRuntimeState(input.dataDir, state);
			return { started: true, status: await this.status() };
		} catch (error) {
			await this.terminate(webIdentity);
			await this.terminate(daemonIdentity);
			const failure = error instanceof Error ? error.message : String(error);
			const daemonAlive = daemonIdentity !== null && this.options.processProvider.isAlive(daemonIdentity.pid);
			const webAlive = webIdentity !== null && this.options.processProvider.isAlive(webIdentity.pid);
			state = {
				...state,
				state: "failed",
				daemon: daemonAlive && daemonIdentity ? toProcessRecord(daemonIdentity) : null,
				web: webAlive && webIdentity ? toProcessRecord(webIdentity) : null,
				updatedAt: nowIso(this.clock),
				lastError: { code: error instanceof ControlError ? error.code : "runtime_start_failed", message: failure },
			};
			writeRuntimeState(input.dataDir, state);
			throw error;
		}
	}

	async status(): Promise<RuntimeStatusReport> {
		const state = readRuntimeState(this.options.dataDir);
		const stateFile = resolveRuntimeStatePath(this.options.dataDir);
		if (!state) {
			return { state: "not_started", dataDir: this.options.dataDir, stateFile, windowsProxy: "not_configured" };
		}

		const daemon = this.checkProcess(state.daemon);
		const web = this.checkProcess(state.web);
		let health: { daemon: boolean; web: boolean } | undefined;
		if (daemon.identityVerified && web.identityVerified) {
			health = {
				daemon: await this.options.health.daemon(state.daemonPort),
				web: await this.options.health.web(state.webPort),
			};
		}
		let lifecycle: RuntimeStatusReport["state"];
		if (state.state === "failed") lifecycle = "failed";
		else if (state.state === "stopped") lifecycle = "stopped";
		else if (!daemon.alive && !web.alive) lifecycle = "stale";
		else if (daemon.identityVerified && web.identityVerified && health?.daemon && health.web) lifecycle = "running";
		else lifecycle = "degraded";

		return {
			state: lifecycle,
			dataDir: state.dataDir,
			stateFile,
			worktree: state.worktree,
			head: state.head,
			webPort: state.webPort,
			daemonPort: state.daemonPort,
			hubOrigin: state.hubOrigin,
			windowsPort: state.windowsPort,
			envFile: state.envFile,
			daemon,
			web,
			health,
			windowsProxy:
				state.windowsPort === null
					? "not_configured"
					: state.webPort === 3005 && health?.web
						? "configured"
						: "unverified",
			daemonBootId: state.daemonBootId,
			lastError: state.lastError,
		};
	}

	async end(): Promise<RuntimeEndResult> {
		const state = readRuntimeState(this.options.dataDir);
		if (!state) return { changed: false, state: "not_started", signaled: [], mismatched: [] };
		if (state.state === "stopped") return { changed: false, state: "stopped", signaled: [], mismatched: [] };

		const signaled: number[] = [];
		const mismatched: number[] = [];
		await this.terminate(state.web, { signaled, mismatched });
		await this.terminate(state.daemon, { signaled, mismatched });

		const webAlive = this.isAlive(state.web);
		const daemonAlive = this.isAlive(state.daemon);
		const updatedAt = nowIso(this.clock);
		if (mismatched.length > 0 || webAlive || daemonAlive) {
			const message =
				mismatched.length > 0
					? `process identity changed for pid ${mismatched.join(", ")}; refusing to signal`
					: "runtime processes are still alive after the grace period";
			writeRuntimeState(this.options.dataDir, {
				...state,
				state: "degraded",
				updatedAt,
				lastError: { code: mismatched.length > 0 ? "runtime_identity_mismatch" : "runtime_end_timeout", message },
			});
			return { changed: true, state: "degraded", signaled, mismatched };
		}

		writeRuntimeState(this.options.dataDir, {
			...state,
			state: "stopped",
			daemon: null,
			web: null,
			daemonBootId: null,
			updatedAt,
			lastError: undefined,
		});
		return { changed: true, state: "stopped", signaled, mismatched };
	}

	private checkProcess(expected: RuntimeProcessRecord | null): RuntimeStatusProcess {
		if (!expected) return { pid: 0, alive: false, identityVerified: false, expected: null };
		const actual = this.options.processProvider.read(expected.pid);
		return {
			pid: expected.pid,
			alive: actual !== null,
			identityVerified: matches(expected, actual),
			expected,
		};
	}

	private isAlive(expected: RuntimeProcessRecord | null): boolean {
		return expected !== null && this.options.processProvider.isAlive(expected.pid);
	}

	private async terminate(
		expected: RuntimeProcessRecord | null,
		result?: { signaled: number[]; mismatched: number[] },
	): Promise<void> {
		if (!expected) return;
		const actual = this.options.processProvider.read(expected.pid);
		if (!actual) return;
		if (!matches(expected, actual)) {
			result?.mismatched.push(expected.pid);
			return;
		}
		this.options.signalSender.send(expected.pid, "SIGTERM");
		result?.signaled.push(expected.pid);
		const deadline = Date.now() + (this.options.endGraceMs ?? DEFAULT_END_GRACE_MS);
		while (Date.now() < deadline && this.options.processProvider.isAlive(expected.pid)) {
			await this.sleep(POLL_INTERVAL_MS);
		}
	}

	private async waitFor(probe: () => Promise<boolean>): Promise<boolean> {
		const timeoutMs = this.options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (await probe()) return true;
			await this.sleep(POLL_INTERVAL_MS);
		}
		return false;
	}
}
