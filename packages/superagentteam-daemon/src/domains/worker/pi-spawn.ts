import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AccountConfig, AgentSession } from "@superagentteam/shared/types";
import { resolveWorkerExtensionPath } from "../../workers/harness.ts";
import { RpcConnection } from "../../workers/rpc-client.ts";
import type { AccountStore } from "../account/store.ts";
import type { SpawnedWorker, WorkerSpawnPort } from "./pool.ts";
import type { WorkerPoolKey } from "./store.ts";

// F018 R2-b real spawn port: pi RPC worker process (0007 §3.5.2 lifecycle).
// Arg construction reuses the task-first harness contract (--mode rpc,
// worker extension, --session/--session-id); the task-bound parts (control
// socket token, role tool policy, run registry) are NOT carried over —
// F018 auth is InvocationCredential and tool allowlists live there.
// Real-RPC E2E lands with R2-d exit E22; unit tests use the mock port.

export interface PiSpawnOptions {
	cliPath: string;
	nodePath?: string;
	sessionDir: string;
	workerAgentDir: string;
	extensionPath?: string;
	controlSocketPath?: string;
	/** F031: explicit curated skill path injected into the v1 worker. */
	richMessagingSkillPath?: string;
	env?: Record<string, string | undefined>;
	/** F030: resolve account credentials and base URL for each worker. */
	accountStore?: AccountStore;
	offline?: boolean;
	clock?: () => number;
}

function safeWorkerDirName(workerId: string): string {
	const safe = workerId.replace(/[^A-Za-z0-9._-]/g, "-");
	return safe.length > 0 ? safe : "worker";
}

function writePrivateJson(path: string, data: unknown): void {
	writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

/**
 * F030: every worker gets its own PI_CODING_AGENT_DIR so two accounts can use
 * different keys/base URLs without racing on a shared auth.json/models.json.
 * Stored secrets are written to auth.json; env-backed accounts fall back to
 * pi's ambient provider env (legacy behavior).
 */
export function prepareWorkerAgentDir(
	agentDir: string,
	account: AccountConfig | undefined,
	apiKey: string | undefined,
): void {
	mkdirSync(agentDir, { recursive: true, mode: 0o700 });
	if (!account) return;
	if (account.apiKeyRef.startsWith("secret:") && !apiKey) {
		throw new Error(`worker_credential_missing: ${account.ref}`);
	}
	if (apiKey) {
		writePrivateJson(join(agentDir, "auth.json"), {
			[account.provider]: { type: "api_key", key: apiKey },
		});
	}
	if (account.apiUrl) {
		writePrivateJson(join(agentDir, "models.json"), {
			providers: { [account.provider]: { baseUrl: account.apiUrl } },
		});
	}
}

export function freshPiSessionId(session: AgentSession, now: number): string {
	const safe = session.id.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
	const base = safe.length > 0 ? safe : "session";
	return `sat-${base}-${now.toString(36)}`;
}

/** R5-b: resolve the v1 A2A extension (not the legacy task-first extension). */
export function resolveA2AExtensionPath(): string {
	const dir = dirname(fileURLToPath(import.meta.url));
	const js = join(dir, "..", "..", "workers", "a2a-extension.js");
	if (existsSync(js)) return js;
	const ts = join(dir, "..", "..", "workers", "a2a-extension.ts");
	if (existsSync(ts)) return ts;
	throw new Error("a2a_worker_extension_not_found");
}

/** F031: the shipped skill lives in the sibling skills package. */
export function resolveRichMessagingSkillPath(): string | null {
	const dir = dirname(fileURLToPath(import.meta.url));
	const candidate = join(
		dir,
		"..",
		"..",
		"..",
		"..",
		"superagentteam-skills",
		"skills",
		"superagentteam-rich-messaging",
	);
	return existsSync(join(candidate, "SKILL.md")) ? candidate : null;
}

export class PiWorkerSpawnPort implements WorkerSpawnPort {
	private readonly options: PiSpawnOptions;

	constructor(options: PiSpawnOptions) {
		this.options = options;
	}

	async spawn(input: {
		workerId: string;
		poolKey: WorkerPoolKey;
		session: AgentSession;
		now: number;
		credentialToken: string;
	}): Promise<SpawnedWorker> {
		const startedAt = this.options.clock?.() ?? Date.now();
		const sessionFile =
			input.session.piSessionFile && input.session.piSessionFile.length > 0 ? input.session.piSessionFile : null;
		const agentDir = join(this.options.workerAgentDir, safeWorkerDirName(input.workerId));
		const account = this.options.accountStore?.get(input.poolKey.accountRef);
		const apiKey = account ? this.options.accountStore?.resolveApiKey(account) : undefined;
		mkdirSync(agentDir, { recursive: true, mode: 0o700 });
		for (const file of ["auth.json", "models.json"]) {
			const source = join(this.options.workerAgentDir, file);
			if (existsSync(source)) copyFileSync(source, join(agentDir, file));
		}
		prepareWorkerAgentDir(agentDir, account, apiKey);
		const args = [
			"--mode",
			"rpc",
			"--no-extensions",
			"--extension",
			this.options.extensionPath ?? resolveWorkerExtensionPath(),
			"--no-context-files",
			"--no-skills",
			...(this.options.richMessagingSkillPath ? ["--skill", this.options.richMessagingSkillPath] : []),
			"--no-prompt-templates",
			"--no-themes",
			"--no-mcp",
			"--approve",
			"--provider",
			input.poolKey.provider,
			"--model",
			input.poolKey.model,
			"--session-dir",
			this.options.sessionDir,
			// Tool policy note (0007 §2 R2): pi-side tool allowlisting is the
			// pi execution layer's job; A2A pi-extension tools are gated by
			// InvocationCredential.allowedTools. No --tools restriction here.
			"--name",
			`superagentteam ${input.workerId}`,
		];
		if (this.options.offline !== false) args.push("--offline");
		if (sessionFile) {
			args.push("--session", sessionFile);
		} else {
			args.push("--session-id", freshPiSessionId(input.session, input.now));
		}
		const connection = new RpcConnection({
			cliPath: this.options.cliPath,
			nodePath: this.options.nodePath,
			cwd: input.poolKey.projectPath,
			env: {
				...(this.options.env ?? process.env),
				PI_CODING_AGENT_DIR: agentDir,
				SUPERAGENTTEAM_WORKER_ID: input.workerId,
				...(this.options.controlSocketPath
					? { SUPERAGENTTEAM_CONTROL_SOCKET: this.options.controlSocketPath }
					: {}),
				...(input.credentialToken ? { SUPERAGENTTEAM_CONTROL_TOKEN: input.credentialToken } : {}),
			},
			args,
		});
		try {
			mkdirSync(this.options.sessionDir, { recursive: true, mode: 0o700 });
			await connection.start();
			const state = (await connection.getState()) as { sessionId?: unknown; sessionFile?: unknown };
			const piSessionId = typeof state.sessionId === "string" ? state.sessionId : null;
			const piSessionFile = typeof state.sessionFile === "string" ? state.sessionFile : sessionFile;
			const endedAt = this.options.clock?.() ?? Date.now();
			return {
				connection,
				pid: connection.pid,
				piSessionId,
				piSessionFile,
				spawnMs: endedAt - startedAt,
			};
		} catch (error) {
			await connection.finish("spawn-failed").catch(() => {});
			throw error;
		}
	}
}
