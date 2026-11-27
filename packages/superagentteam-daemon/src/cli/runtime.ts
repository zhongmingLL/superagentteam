import { existsSync } from "node:fs";
import { join } from "node:path";
import { LinuxProcessIdentityProvider } from "../infrastructure/process/process.ts";
import { RealProcessSignalSender } from "../infrastructure/process/signal.ts";
import { defaultRuntimeEnvFile, resolveRuntimeEnv } from "../infrastructure/supervisor/env.ts";
import {
	assertBuilt,
	gitHead,
	HttpRuntimeHealth,
	isPortFree,
	RealRuntimeSpawner,
	readDaemonBootId,
	resolveRuntimeWorktree,
	syncWorktree,
} from "../infrastructure/supervisor/real.ts";
import { RuntimeService } from "../infrastructure/supervisor/service.ts";
import { checkWritePath, type WritePathCheckResult } from "../infrastructure/supervisor/write-path.ts";
import { ControlError } from "../shared/control/errors.ts";
import { flag, numberOption, option, type ParsedArgs } from "./args.ts";
import type { CliCommandContext } from "./context.ts";
import { writeJson, writeLine } from "./output.ts";

const DEFAULT_WEB_PORT = 3005;
const DEFAULT_DAEMON_PORT = 3014;
const DEFAULT_SYNC_REF = "origin/superagentteam-work";

/**
 * The daemon only accepts browser requests whose Origin exactly matches its
 * hub origin. Default it to the web entry so `runtime start` never launches a
 * page that its own API rejects; 3103 is a retired Windows proxy, not the UI.
 */
export function defaultHubOrigin(webPort: number): string {
	return `http://localhost:${webPort}`;
}

function service(context: CliCommandContext): RuntimeService {
	return new RuntimeService({
		dataDir: context.dataDir,
		spawner: new RealRuntimeSpawner(context.dataDir),
		processProvider: new LinuxProcessIdentityProvider(),
		signalSender: new RealProcessSignalSender(),
		health: new HttpRuntimeHealth(),
		isPortFree,
		readDaemonBootId,
	});
}

function portOption(args: ParsedArgs, name: string, fallback: number): number {
	return numberOption(args, name) ?? fallback;
}

async function start(args: ParsedArgs, context: CliCommandContext, restart: boolean): Promise<number> {
	const runtime = service(context);
	if (restart) {
		const ended = await runtime.end();
		if (ended.state === "degraded") {
			throw new ControlError(
				"runtime_end_incomplete",
				"runtime did not fully end; inspect `superagentteam runtime status` before restarting",
			);
		}
	}
	const worktree = resolveRuntimeWorktree(option(args, "worktree"));
	if (!existsSync(join(context.dataDir, "accounts.json"))) {
		throw new ControlError(
			"runtime_data_uninitialized",
			`data dir ${context.dataDir} has no accounts.json; initialize it before starting the runtime`,
		);
	}
	if (flag(args, "sync")) syncWorktree(worktree, option(args, "sync-ref") ?? DEFAULT_SYNC_REF);
	assertBuilt(worktree);
	const head = gitHead(worktree);
	const envFile = option(args, "env-file") ?? (existsSync(defaultRuntimeEnvFile()) ? defaultRuntimeEnvFile() : null);
	const resolved = resolveRuntimeEnv({ dataDir: context.dataDir, envFile, inherited: process.env });
	if (resolved.missingEnvNames.length > 0) {
		throw new ControlError(
			"runtime_env_missing",
			`missing required environment: ${resolved.missingEnvNames.join(", ")}; add them to ${envFile ?? defaultRuntimeEnvFile()} (mode 0600)`,
		);
	}
	const webPort = portOption(args, "web-port", DEFAULT_WEB_PORT);
	const result = await runtime.start({
		worktree,
		head,
		dataDir: context.dataDir,
		webPort,
		daemonPort: portOption(args, "daemon-port", DEFAULT_DAEMON_PORT),
		hubOrigin: option(args, "hub-origin") ?? defaultHubOrigin(webPort),
		envFile,
		env: resolved.env,
		requiredEnvNames: resolved.requiredEnvNames,
	});
	if (context.json) writeJson(result);
	else {
		writeLine(result.started ? "runtime started" : "runtime already running");
		writeLine(`state: ${result.status.state}`);
		writeLine(`worktree: ${result.status.worktree ?? worktree}`);
		writeLine(`head: ${result.status.head ?? head}`);
		writeLine(`web: http://127.0.0.1:${result.status.webPort}`);
		writeLine(`daemon: http://127.0.0.1:${result.status.daemonPort}`);
		writeLine(`public: ${result.status.hubOrigin}`);
		writeLine(`origins: ${result.status.hubOrigin} (+ loopback aliases)`);
		writeLine(`state file: ${result.status.stateFile}`);
	}
	return 0;
}

async function status(args: ParsedArgs, context: CliCommandContext): Promise<number> {
	const report = await service(context).status();
	const checkWrite = flag(args, "check-write");
	let writePath: WritePathCheckResult | undefined;
	if (checkWrite) {
		writePath =
			report.state === "running" && report.daemonPort !== undefined && report.hubOrigin !== undefined
				? await checkWritePath({ daemonPort: report.daemonPort, hubOrigin: report.hubOrigin })
				: { ok: false, status: 0, detail: "runtime is not running" };
	}
	if (context.json) writeJson(writePath ? { ...report, writePath } : report);
	else {
		writeLine(`state: ${report.state}`);
		if (report.worktree) writeLine(`worktree: ${report.worktree}`);
		if (report.head) writeLine(`head: ${report.head}`);
		if (report.webPort !== undefined) writeLine(`web: http://127.0.0.1:${report.webPort}`);
		if (report.daemonPort !== undefined) writeLine(`daemon: http://127.0.0.1:${report.daemonPort}`);
		if (report.hubOrigin) {
			writeLine(`public: ${report.hubOrigin}`);
			writeLine(`origins: ${report.hubOrigin} (+ loopback aliases)`);
		}
		if (report.daemon)
			writeLine(
				`daemon pid: ${report.daemon.pid || "-"} alive=${report.daemon.alive} verified=${report.daemon.identityVerified}`,
			);
		if (report.web)
			writeLine(
				`web pid: ${report.web.pid || "-"} alive=${report.web.alive} verified=${report.web.identityVerified}`,
			);
		if (report.health) writeLine(`health: daemon=${report.health.daemon} web=${report.health.web}`);
		for (const warning of report.warnings ?? []) writeLine(`warning: ${warning}`);
		if (report.lastError) writeLine(`last error: ${report.lastError.code}: ${report.lastError.message}`);
		if (writePath) {
			writeLine(
				`write path: ${writePath.ok ? "ok" : "FAILED"} (${writePath.status}${writePath.detail ? `: ${writePath.detail}` : ""})`,
			);
		}
		writeLine(`state file: ${report.stateFile}`);
	}
	return writePath !== undefined && !writePath.ok ? 1 : 0;
}

async function end(context: CliCommandContext): Promise<number> {
	const result = await service(context).end();
	if (context.json) writeJson(result);
	else {
		writeLine(`runtime ${result.state}`);
		if (result.signaled.length > 0) writeLine(`signaled: ${result.signaled.join(", ")}`);
		if (result.mismatched.length > 0) writeLine(`identity mismatch (not signaled): ${result.mismatched.join(", ")}`);
	}
	return result.state === "degraded" ? 1 : 0;
}

export async function runRuntimeCommand(args: ParsedArgs, context: CliCommandContext): Promise<number> {
	const subcommand = args.positionals[0];
	if (subcommand === "start") return start(args, context, false);
	if (subcommand === "restart") return start(args, context, true);
	if (subcommand === "status") return status(args, context);
	if (subcommand === "end") return end(context);
	throw new ControlError("invalid_input", "usage: superagentteam runtime <start|status|end|restart>");
}
