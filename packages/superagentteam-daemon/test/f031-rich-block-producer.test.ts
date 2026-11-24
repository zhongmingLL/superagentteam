import { mkdtempSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccountConfig, AgentCatalog, AgentConfig, RichBlock } from "@superagentteam/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type A2ARuntime, buildA2ARuntime } from "../src/domains/a2a/runtime.ts";
import { buildRegistry } from "../src/domains/agent/registry.ts";
import { RichBlockService } from "../src/domains/rich-block/service.ts";
import { RICH_BLOCK_TOOL_NAME, RICH_BLOCK_TOOL_SPEC } from "../src/domains/rich-block/tool-surface.ts";
import type { WorkerRpcConnection, WorkerSpawnPort } from "../src/domains/worker/pool.ts";
import { F018Database } from "../src/infrastructure/db/database.ts";
import superagentteamA2AExtension from "../src/workers/a2a-extension.ts";
import type { RpcEvent } from "../src/workers/rpc-client.ts";

const dirs: string[] = [];
const runtimes: A2ARuntime[] = [];
const ACCOUNT: AccountConfig = { ref: "main", provider: "pi", apiKeyRef: "KEY", models: ["m1"] };
const ALLOWED = ["post_message", "cross_post_message", "multi_mention", "thread_context", "create_rich_block"];

function agentConfig(id: string): AgentConfig {
	return {
		id,
		mentionPatterns: [`@${id}`],
		displayName: `Agent ${id}`,
		contextWindow: 128_000,
		roleId: "worker",
		roleDescription: "does things",
		restrictions: [],
		strengths: [],
		accountRef: "main",
		defaultModel: "m1",
		sessionChain: true,
		enabled: true,
	};
}

class NeverSpawnPort implements WorkerSpawnPort {
	async spawn(): Promise<{
		connection: WorkerRpcConnection;
		pid: number | null;
		piSessionId: string | null;
		piSessionFile: string | null;
		spawnMs: number;
	}> {
		throw new Error("unexpected_worker_spawn");
	}
}

class RichCallingConnection implements WorkerRpcConnection {
	private readonly listeners: Array<(event: RpcEvent) => void> = [];
	private readonly socketPath: string;
	private readonly workerId: string;
	private readonly token: string;

	constructor(socketPath: string, workerId: string, token: string) {
		this.socketPath = socketPath;
		this.workerId = workerId;
		this.token = token;
	}

	onEvent(listener: (event: RpcEvent) => void): () => void {
		this.listeners.push(listener);
		return () => {
			const index = this.listeners.indexOf(listener);
			if (index >= 0) this.listeners.splice(index, 1);
		};
	}

	private emit(event: RpcEvent): void {
		for (const listener of [...this.listeners]) listener(event);
	}

	async promptAndWait(
		_message: string,
		options: { timeoutMs: number; signal?: AbortSignal; onAccepted?: () => void },
	): Promise<{ aborted: boolean }> {
		options.onAccepted?.();
		const response = await call(this.socketPath, {
			type: "rich_block_create",
			workerId: this.workerId,
			token: this.token,
			input: { block: card("e2e-card") },
		});
		if (response.ok !== true) throw new Error(JSON.stringify(response.error));
		this.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Done." } });
		this.emit({
			type: "message_end",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "Done." }],
				usage: { inputTokens: 1, outputTokens: 1 },
			},
		});
		this.emit({ type: "agent_settled", aborted: false });
		return { aborted: false };
	}

	async finish(): Promise<void> {}
}

class RichCallingSpawnPort implements WorkerSpawnPort {
	private readonly socketPath: string;

	constructor(socketPath: string) {
		this.socketPath = socketPath;
	}

	async spawn(input: { workerId: string; credentialToken: string }): Promise<{
		connection: WorkerRpcConnection;
		pid: number | null;
		piSessionId: string | null;
		piSessionFile: string | null;
		spawnMs: number;
	}> {
		return {
			connection: new RichCallingConnection(this.socketPath, input.workerId, input.credentialToken),
			pid: 4242,
			piSessionId: "pi-rich",
			piSessionFile: null,
			spawnMs: 1,
		};
	}
}

function makeWorld(allowedTools: string[] = ALLOWED) {
	const dir = mkdtempSync(join(tmpdir(), "f031-rich-"));
	dirs.push(dir);
	const fd = new F018Database({ path: join(dir, "f018.db") });
	const catalog: AgentCatalog = { version: 1, agents: [agentConfig("a1")] };
	const registry = buildRegistry(catalog, [ACCOUNT]);
	const runtime = buildA2ARuntime({
		db: fd.db,
		registry,
		spawn: new NeverSpawnPort(),
		clock: () => 1_000,
		processStartedAt: 1,
		controlSocketPath: join(dir, "a2a.sock"),
	});
	runtimes.push(runtime);
	runtime.threads.create({ id: "t1", projectPath: "/p", createdBy: "u1", now: 1 });
	const session = runtime.sessions.ensureActive({
		threadId: "t1",
		agentId: "a1",
		userId: "u1",
		workingDirectory: "/p",
		now: 1,
	});
	runtime.records.create({
		invocationId: "inv1",
		threadId: "t1",
		userId: "u1",
		sourceRecordId: "src1",
		userMessageId: null,
		targetAgentIds: ["a1"],
		now: 2,
	});
	runtime.turns.createRunning({
		turnExecutionId: "te1",
		parentInvocationId: "inv1",
		threadId: "t1",
		userId: "u1",
		agentId: "a1",
		executionKind: "ordinary",
		causal: { triggerMessageId: "m1", a2aDepth: 0 },
		startedAt: 3,
	});
	const attempt = runtime.attempts.appendQueued({
		attemptId: "at1",
		parentInvocationId: "inv1",
		queueEntryId: "q1",
		threadId: "t1",
		targetAgentId: "a1",
		attempt: 1,
		now: 3,
	}).record;
	runtime.attempts.markStarting(attempt.attemptId, { agentSessionId: session.id, now: 4 });
	runtime.messages.append({
		id: "rm1",
		threadId: "t1",
		from: { kind: "agent", agentId: "a1" },
		content: "",
		lifecycle: {
			kind: "response",
			parentInvocationId: "inv1",
			turnExecutionId: "te1",
			target: { kind: "agent", id: "a1" },
			status: "processing",
			startedAt: 4,
		},
		now: 4,
	});
	runtime.attempts.bindAppended(attempt.attemptId, {
		turnExecutionId: "te1",
		agentSessionId: session.id,
		workerId: null,
		provider: "pi",
		model: "m1",
		modelFamily: null,
		responseMessageId: "rm1",
		now: 5,
	});
	runtime.drafts.create({
		attemptId: attempt.attemptId,
		turnExecutionId: "te1",
		parentInvocationId: "inv1",
		threadId: "t1",
		agentId: "a1",
		content: "",
		toolEvents: [],
		thinking: null,
		richBlocks: [],
		createdAt: 5,
		updatedAt: 5,
	});
	const minted = runtime.credentials.create({
		turnExecutionId: "te1",
		parentInvocationId: "inv1",
		threadId: "t1",
		agentId: "a1",
		agentSessionId: session.id,
		userId: "u1",
		allowedTools,
		now: 5,
	});
	const workerId = "w1";
	runtime.workerStore.ensure({
		workerId,
		poolKey: { projectPath: "/p", accountRef: "main", provider: "pi", model: "m1" },
		now: 5,
		leaseTtlMs: 300_000,
	});
	runtime.workerStore.markOnline(workerId, 4242, 5);
	runtime.bindings.bind({ agentSessionId: session.id, workerId, now: 5 });
	return { dir, runtime, socketPath: join(dir, "a2a.sock"), workerId, token: minted.token };
}

function call(socketPath: string, request: Record<string, unknown>): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const socket = connect(socketPath);
		let buffer = "";
		socket.setEncoding("utf8");
		socket.once("connect", () => socket.write(`${JSON.stringify({ id: "rich-req", ...request })}\n`));
		socket.on("data", (chunk: string) => {
			buffer += chunk;
			const index = buffer.indexOf("\n");
			if (index < 0) return;
			const line = buffer.slice(0, index);
			socket.destroy();
			try {
				resolve(JSON.parse(line) as Record<string, unknown>);
			} catch (error) {
				reject(error);
			}
		});
		socket.on("error", reject);
	});
}

function card(id = "card-1"): RichBlock {
	return { id, kind: "card", v: 1, title: "Result", bodyMarkdown: "ok" };
}

afterEach(async () => {
	for (const runtime of runtimes.splice(0)) await runtime.control?.stop();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	vi.unstubAllEnvs();
});

describe("F031 rich block producer", () => {
	it("stores one block and makes repeated ids idempotent", () => {
		const w = makeWorld();
		const service = new RichBlockService({ drafts: w.runtime.drafts });
		const first = service.create("te1", card());
		expect(first).toEqual({ blockId: "card-1", blockCount: 1, maxBlocks: 20 });
		const replay = service.create("te1", { ...card(), title: "Updated" });
		expect(replay.blockCount).toBe(1);
		expect(w.runtime.drafts.getByTurn("te1")?.richBlocks).toEqual([{ ...card(), title: "Updated" }]);
	});

	it("rejects unknown kinds, approval blocks, oversized blocks, and more than 20 blocks", () => {
		const w = makeWorld();
		const service = new RichBlockService({ drafts: w.runtime.drafts });
		expect(() => service.create("te1", { id: "x", kind: "unknown", v: 1 })).toThrow(
			expect.objectContaining({ code: "rich_block_invalid" }),
		);
		expect(() => service.create("te1", { id: "x", kind: "approval", v: 1 })).toThrow(
			expect.objectContaining({ code: "rich_block_approval_forbidden" }),
		);
		expect(() =>
			service.create("te1", { id: "big", kind: "html_widget", v: 1, html: "x".repeat(65 * 1024) }),
		).toThrow(expect.objectContaining({ code: "rich_block_too_large" }));
		for (let index = 0; index < 20; index += 1) service.create("te1", card(`card-${index}`));
		expect(() => service.create("te1", card("card-21"))).toThrow(
			expect.objectContaining({ code: "rich_block_too_many" }),
		);
	});

	it("dispatches through the credential-scoped control socket and enforces allowlist/running turn", async () => {
		const w = makeWorld();
		await w.runtime.control!.start();
		const response = await call(w.socketPath, {
			type: "rich_block_create",
			workerId: w.workerId,
			token: w.token,
			input: { block: card() },
		});
		expect(response.ok).toBe(true);
		expect(response.result).toEqual({ blockId: "card-1", blockCount: 1, maxBlocks: 20 });
		expect(w.runtime.drafts.getByTurn("te1")?.richBlocks).toEqual([card()]);

		const invalid = await call(w.socketPath, {
			type: "rich_block_create",
			workerId: w.workerId,
			token: w.token,
			input: { block: { id: "x", kind: "unknown", v: 1 } },
		});
		expect((invalid.error as { code: string }).code).toBe("rich_block_invalid");

		w.runtime.turns.transitionTerminal("te1", { status: "failed", endedAt: 2_000, terminalReason: "test" });
		const stopped = await call(w.socketPath, {
			type: "rich_block_create",
			workerId: w.workerId,
			token: w.token,
			input: { block: card("card-2") },
		});
		expect((stopped.error as { code: string }).code).toBe("turn_not_running");
	});

	it("carries a worker-created block from draft through T2 into the final message", async () => {
		const dir = mkdtempSync(join(tmpdir(), "f031-rich-turn-"));
		dirs.push(dir);
		const fd = new F018Database({ path: join(dir, "f018.db") });
		const registry = buildRegistry({ version: 1, agents: [agentConfig("a1")] }, [ACCOUNT]);
		const socketPath = join(dir, "a2a.sock");
		let now = 1;
		const runtime = buildA2ARuntime({
			db: fd.db,
			registry,
			spawn: new RichCallingSpawnPort(socketPath),
			clock: () => ++now,
			processStartedAt: 1,
			controlSocketPath: socketPath,
		});
		runtimes.push(runtime);
		runtime.threads.create({ id: "t1", projectPath: "/p", createdBy: "u1", now: 1 });
		await runtime.control!.start();
		const submitted = runtime.ingress.submit({ threadId: "t1", userId: "u1", body: "go @a1", now: 2 });
		const drained = await runtime.processor.drain("t1", "u1");
		expect(drained.processed).toBe(1);
		const attempt = runtime.attempts.getLatest(`inv:t1:${submitted.message.id}`, "a1")!;
		const response = runtime.messages.get(attempt.responseMessageId!)!;
		expect(response.content).toBe("Done.");
		expect(response.extra?.rich).toEqual({ v: 1, blocks: [card("e2e-card")] });
		expect(runtime.drafts.getByTurn(attempt.turnExecutionId!)).toBeNull();
	});

	it("rejects a credential without create_rich_block", async () => {
		const w = makeWorld(["post_message"]);
		await w.runtime.control!.start();
		const denied = await call(w.socketPath, {
			type: "rich_block_create",
			workerId: w.workerId,
			token: w.token,
			input: { block: card() },
		});
		expect((denied.error as { code: string }).code).toBe("tool_not_allowed");
	});

	it("registers the producer tool in the v1 extension and executes it", async () => {
		const w = makeWorld();
		await w.runtime.control!.start();
		vi.stubEnv("SUPERAGENTTEAM_CONTROL_SOCKET", w.socketPath);
		vi.stubEnv("SUPERAGENTTEAM_CONTROL_TOKEN", w.token);
		vi.stubEnv("SUPERAGENTTEAM_WORKER_ID", w.workerId);
		const tools = new Map<
			string,
			{
				execute(
					toolCallId: string,
					params: Record<string, unknown>,
					signal: AbortSignal | undefined,
				): Promise<{ details: Record<string, unknown> }>;
			}
		>();
		superagentteamA2AExtension({
			on: () => {},
			registerTool: (tool) => tools.set(tool.name, tool),
		});
		expect(tools.has(RICH_BLOCK_TOOL_NAME)).toBe(true);
		expect(RICH_BLOCK_TOOL_SPEC.inputSchema).toMatchObject({ type: "object", required: ["block"] });
		const executed = await tools.get(RICH_BLOCK_TOOL_NAME)!.execute("tc-rich", { block: card() }, undefined);
		expect(executed.details.result).toEqual({ blockId: "card-1", blockCount: 1, maxBlocks: 20 });
		expect(w.runtime.drafts.getByTurn("te1")?.richBlocks).toEqual([card()]);
	});
});
