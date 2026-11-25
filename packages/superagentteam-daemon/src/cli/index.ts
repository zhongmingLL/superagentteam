import { consoleLinkUrl, createConsoleToken } from "../api/console-link.ts";
import { initOperatorCredential } from "../auth/operator.ts";
import { ControlError } from "../control/errors.ts";
import { resolveControlDataDir } from "../data-dir.ts";
import { envValue } from "../env.ts";
import { resolveDaemonPaths } from "../paths.ts";
import { readStateFile } from "../state.ts";
import { flag, option, parseArgs } from "./args.ts";
import { openCliCommandContext } from "./context.ts";
import { runDaemonCommand } from "./daemon.ts";
import { runMemoryCommand } from "./memory.ts";
import { writeJson, writeLine } from "./output.ts";
import { runRuntimeCommand } from "./runtime.ts";
import { runA2AThreadCommand } from "./thread-a2a.ts";

// F032: these task-first commands lived on the frozen control.db runtime. A2A v1
// uses `thread` plus the Hub API; keep a typed, actionable rejection instead of
// letting callers fall through to a generic "unknown command".
const RETIRED_COMMANDS = new Set([
	"backlog",
	"sop",
	"task",
	"approval",
	"budget",
	"deployment",
	"schedule",
	"session",
	"profile",
	"gate",
	"merge",
	"eval",
]);

export async function runCli(argv: readonly string[]): Promise<number> {
	const { argvWithoutGlobals, globals } = extractGlobalOptions(argv);
	const [command, ...rest] = argvWithoutGlobals;
	if (command === "auth" && rest[0] === "init") return runAuthInit([...rest.slice(1), ...globals]);
	if (command === "auth" && rest[0] === "console-link") return runAuthConsoleLink([...rest.slice(1), ...globals]);
	if (command === "memory") return runMemoryCommand([...rest, ...globals]);
	if (!command || command === "help" || command === "--help") {
		writeUsage();
		return 0;
	}
	const args = parseArgs(
		[...rest, ...globals],
		[
			"json",
			"follow",
			"help",
			"hard-gate",
			"spec-change",
			"allow-unsynced-base",
			"allow-primary-worktree",
			"clear",
			"new-boot",
			"sync",
		],
	);
	if (flag(args, "help")) {
		writeUsage();
		return 0;
	}
	if (RETIRED_COMMANDS.has(command)) {
		throw new ControlError(
			"legacy_command_retired",
			`the task-first legacy command "${command}" is retired; use the A2A v1 thread commands or the Hub API`,
		);
	}
	if (command === "thread") {
		const engine = option(args, "engine");
		if (engine !== undefined && engine !== "a2a") {
			if (engine === "legacy") {
				throw new ControlError(
					"legacy_engine_retired",
					"the legacy task-first thread engine is retired; `thread` uses A2A v1 only",
				);
			}
			throw new ControlError("invalid_input", `unknown thread engine ${engine}; use a2a`);
		}
		return await runA2AThreadCommand(args, {
			dataDir: resolveControlDataDir(option(args, "data-dir")),
			json: flag(args, "json"),
		});
	}
	if (command === "daemon") {
		return await runDaemonCommand(args, openCliCommandContext(args));
	}
	if (command === "runtime") {
		return await runRuntimeCommand(args, openCliCommandContext(args));
	}
	throw new ControlError("invalid_input", `unknown command ${command}`);
}

function extractGlobalOptions(argv: readonly string[]): { argvWithoutGlobals: string[]; globals: string[] } {
	const argvWithoutGlobals: string[] = [];
	const globals: string[] = [];
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index]!;
		if (arg === "--data-dir") {
			const value = argv[index + 1];
			if (value === undefined || value.startsWith("--")) {
				throw new ControlError("invalid_input", "--data-dir requires a value");
			}
			globals.push("--data-dir", value);
			index += 1;
			continue;
		}
		if (arg.startsWith("--data-dir=")) {
			globals.push(arg);
			continue;
		}
		if (arg === "--json") {
			globals.push(arg);
			continue;
		}
		argvWithoutGlobals.push(arg);
	}
	return { argvWithoutGlobals, globals };
}

function runAuthInit(argv: readonly string[]): number {
	const args = parseArgs(argv, ["rotate"]);
	const dataDir = option(args, "data-dir");
	const resolved = resolveControlDataDir(dataDir);
	const paths = initOperatorCredential({ dataDir: resolved, rotate: flag(args, "rotate") });
	writeJson({ dataDir: resolved, publicKeyPath: paths.publicKeyPath, fingerprint: paths.fingerprint });
	return 0;
}

function runAuthConsoleLink(argv: readonly string[]): number {
	const args = parseArgs(argv, ["json"]);
	const dataDir = resolveControlDataDir(option(args, "data-dir"));
	const paths = resolveDaemonPaths(dataDir);
	const state = readStateFile(paths.stateFile);
	if (!state?.healthPort) {
		throw new ControlError("invalid_state", "daemon is not running or has no health port; start the daemon first");
	}
	const ttlText = option(args, "ttl-ms");
	const ttlMs = ttlText === undefined ? undefined : Number(ttlText);
	if (ttlMs !== undefined && (!Number.isFinite(ttlMs) || ttlMs <= 0)) {
		throw new ControlError("invalid_input", "--ttl-ms must be a positive number");
	}
	const created = createConsoleToken({ dataDir, ttlMs });
	const hubOrigin =
		option(args, "hub-origin") ?? state.hubOrigin ?? envValue(process.env, "HUB_ORIGIN") ?? "http://localhost:3000";
	const url = consoleLinkUrl({ hubOrigin, port: state.healthPort, token: created.token });
	if (flag(args, "json")) writeJson({ url, expiresAt: created.payload.exp });
	else writeLine(url);
	return 0;
}

function writeUsage(): void {
	writeLine("usage: superagentteam <command> [options]");
	writeLine("commands:");
	writeLine("  auth init [--data-dir <path>] [--rotate]");
	writeLine("  auth console-link [--data-dir <path>] [--ttl-ms <ms>] [--hub-origin <url>]");
	writeLine("  thread <create|list|show|post|tail>");
	writeLine("  daemon <status|stop>");
	writeLine("  runtime <start|status|end|restart>");
	writeLine("  memory <index|status|recall|read|trigger>");
	writeLine("global options: --data-dir <path> --json");
	writeLine("  global options may precede the command");
	writeLine("thread create: --project-path <path> [--title <text>] [--id <threadId>]");
	writeLine("thread post: <threadId> <body> [--to <agentId> ...] [--id <messageId>]");
	writeLine("thread post replay: same --id + omitted --to reuses stored targets; different --to conflicts");
	writeLine("thread tail: <threadId> [--after-seq N] [--follow] [--interval-ms N]");
	writeLine("runtime start: --worktree <path> --web-port 3005 --daemon-port 3014 [--hub-origin <url>] [--sync]");
	writeLine("runtime hub-origin: defaults to http://localhost:<web-port>; must match the browser entry");
	writeLine("runtime env: default ~/.config/superagentteam/runtime.env (mode 0600) or --env-file <path>");
	writeLine("legacy task-first commands were retired in F032; use thread or the Hub API");
}
