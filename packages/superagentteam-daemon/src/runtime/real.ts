import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import { ControlError } from "../control/errors.ts";
import { envValue } from "../env.ts";
import type { RuntimeDaemonSpawnInput, RuntimeHealthProbe, RuntimeSpawner, RuntimeWebSpawnInput } from "./types.ts";

const DEFAULT_HEALTH_TIMEOUT_MS = 2_000;

function stringEnv(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (value !== undefined) result[key] = value;
	}
	return result;
}

export class RealRuntimeSpawner implements RuntimeSpawner {
	private readonly dataDir: string;

	constructor(dataDir: string) {
		this.dataDir = dataDir;
	}

	spawnDaemon(input: RuntimeDaemonSpawnInput): { pid: number } {
		const log = this.openLog("runtime-daemon.log");
		const child = spawn(process.execPath, [join(input.worktree, "scripts", "f025-e2e-daemon.mjs")], {
			cwd: input.worktree,
			detached: true,
			stdio: ["ignore", log.fd, log.fd],
			env: {
				...stringEnv(process.env),
				...stringEnv(input.env),
				SUPERAGENTTEAM_E2E_DATA_DIR: input.dataDir,
				SUPERAGENTTEAM_E2E_PORT: String(input.port),
				SUPERAGENTTEAM_HUB_ORIGIN: input.hubOrigin,
				SUPERAGENTTEAM_RUNNING_REVISION: input.revision,
			},
		});
		closeSync(log.fd);
		child.unref();
		if (child.pid === undefined) throw new Error("daemon spawn did not return a pid");
		return { pid: child.pid };
	}

	spawnWeb(input: RuntimeWebSpawnInput): { pid: number } {
		const log = this.openLog("runtime-web.log");
		const child = spawn(
			process.execPath,
			[
				join(input.worktree, "node_modules", ".bin", "vite"),
				"--host",
				"0.0.0.0",
				"--port",
				String(input.webPort),
				"--strictPort",
			],
			{
				cwd: join(input.worktree, "packages", "superagentteam-web"),
				detached: true,
				stdio: ["ignore", log.fd, log.fd],
				env: {
					...stringEnv(process.env),
					...stringEnv(input.env),
					SUPERAGENTTEAM_DAEMON_ORIGIN: `http://127.0.0.1:${input.daemonPort}`,
				},
			},
		);
		closeSync(log.fd);
		child.unref();
		if (child.pid === undefined) throw new Error("web spawn did not return a pid");
		return { pid: child.pid };
	}

	private openLog(name: string): { fd: number } {
		const dir = join(this.dataDir, "logs");
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		return { fd: openSync(join(dir, name), "a", 0o600) };
	}
}

export class HttpRuntimeHealth implements RuntimeHealthProbe {
	private readonly timeoutMs: number;

	constructor(timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS) {
		this.timeoutMs = timeoutMs;
	}

	async daemon(port: number): Promise<boolean> {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/health`, {
				signal: AbortSignal.timeout(this.timeoutMs),
			});
			if (!response.ok) return false;
			const body = (await response.json()) as { status?: unknown };
			return body.status === "ready";
		} catch {
			return false;
		}
	}

	async web(port: number): Promise<boolean> {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(this.timeoutMs) });
			return response.ok;
		} catch {
			return false;
		}
	}
}

export function isPortFree(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = createServer();
		server.once("error", () => resolve(false));
		server.listen({ port, host: "0.0.0.0", exclusive: true }, () => {
			server.close(() => resolve(true));
		});
	});
}

export function readDaemonBootId(dataDir: string): string | null {
	const file = join(dataDir, "daemon-state.json");
	if (!existsSync(file)) return null;
	try {
		const state = JSON.parse(readFileSync(file, "utf8")) as { bootId?: unknown; state?: unknown };
		return typeof state.bootId === "string" && state.state === "ready" ? state.bootId : null;
	} catch {
		return null;
	}
}

export function isSuperAgentTeamCheckout(dir: string): boolean {
	return (
		existsSync(join(dir, "packages", "superagentteam-daemon", "package.json")) &&
		existsSync(join(dir, "packages", "superagentteam-web", "package.json"))
	);
}

function findCheckoutUpwards(start: string): string | null {
	let dir = resolve(start);
	for (;;) {
		if (isSuperAgentTeamCheckout(dir)) return dir;
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

export function resolveRuntimeWorktree(explicit?: string): string {
	if (explicit && explicit.trim() !== "") return explicit;
	const fromEnv = envValue(process.env, "RUNTIME_WORKTREE");
	if (fromEnv && fromEnv.trim() !== "") return fromEnv;
	const checkout = findCheckoutUpwards(process.cwd());
	if (checkout) {
		if (basename(checkout) === "superagentteam-runtime") return checkout;
		const sibling = resolve(checkout, "..", "superagentteam-runtime");
		if (isSuperAgentTeamCheckout(sibling)) return sibling;
		return checkout;
	}
	throw new ControlError("runtime_worktree_missing", "cannot resolve runtime worktree; pass --worktree <path>");
}

export function gitHead(worktree: string): string {
	try {
		return execFileSync("git", ["-C", worktree, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
	} catch (error) {
		throw new ControlError("runtime_worktree_invalid", `cannot read HEAD for runtime worktree ${worktree}`, {
			cause: error,
		});
	}
}

export function syncWorktree(worktree: string, ref: string): void {
	try {
		execFileSync("git", ["-C", worktree, "fetch", "origin"], { stdio: "inherit" });
		execFileSync("git", ["-C", worktree, "merge", "--ff-only", ref], { stdio: "inherit" });
	} catch (error) {
		throw new ControlError("runtime_sync_failed", `cannot fast-forward runtime worktree ${worktree} to ${ref}`, {
			cause: error,
		});
	}
}

export function assertBuilt(worktree: string): void {
	const required = [
		join(worktree, "packages", "superagentteam-daemon", "dist", "cli.js"),
		join(worktree, "scripts", "f025-e2e-daemon.mjs"),
		join(worktree, "node_modules", ".bin", "vite"),
	];
	for (const file of required) {
		if (!existsSync(file)) {
			throw new Error(`runtime build is missing ${file}; run \`NODE_ENV=development npm run build:offline\``);
		}
	}
}
