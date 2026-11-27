import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccountConfig, AgentCatalog, AgentConfig } from "@superagentteam/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OperatorMessageIngress } from "../src/domains/a2a/router.ts";
import { InvokeSingleAgent, type PreparedDispatch } from "../src/domains/agent/invoke-single-agent.ts";
import { buildRegistry } from "../src/domains/agent/registry.ts";
import type { AgentTurnCompletion, AgentTurnInput } from "../src/domains/agent/route.ts";
import { AgentRouter, type AssembleContext } from "../src/domains/agent/route.ts";
import { InvocationCredentialStore } from "../src/domains/auth/store.ts";
import { InvocationAttemptStore, InvocationRecordStore, TurnExecutionStore } from "../src/domains/invocation/store.ts";
import { AgentReadStateStore, MessageStore } from "../src/domains/message/store.ts";
import { QueueProcessor } from "../src/domains/queue/processor.ts";
import { QueueLedgerStore } from "../src/domains/queue/store.ts";
import { InvocationTracker } from "../src/domains/queue/tracker.ts";
import { ResponseDraftStore } from "../src/domains/response/store.ts";
import { AgentSessionStore } from "../src/domains/session/store.ts";
import { ThreadStore } from "../src/domains/thread/store.ts";
import { F018Database } from "../src/infrastructure/db/database.ts";

const dirs: string[] = [];

function agentConfig(id: string): AgentConfig {
	return {
		id,
		mentionPatterns: [`@${id}`],
		displayName: `Agent ${id}`,
		contextWindow: 16_384,
		roleId: "worker",
		roleDescription: "F044b Phase B ownership",
		restrictions: [],
		strengths: [],
		accountRef: "main",
		defaultModel: "m1",
		sessionChain: true,
		enabled: true,
	};
}

const ACCOUNT: AccountConfig = { ref: "main", provider: "pi", apiKeyRef: "KEY", models: ["m1"] };

function completion(prepared: PreparedDispatch, responseText = `out:${prepared.agentId}`): AgentTurnCompletion {
	return {
		result: {
			agentId: prepared.agentId,
			turnExecutionId: prepared.turnExecutionId,
			responseMessageId: `resp:${prepared.turnExecutionId}`,
			status: "completed",
			responseText,
		},
		release: async () => {},
	};
}

function makeWorld() {
	const dir = mkdtempSync(join(tmpdir(), "f044b-phase-b-"));
	dirs.push(dir);
	const db = new F018Database({ path: join(dir, "f044b.db") });
	db.db
		.prepare(
			"INSERT INTO threads (id, project_path, created_by, last_active_at, created_at, updated_at) VALUES ('t1', '/p', 'u1', 1, 1, 1)",
		)
		.run();
	const catalog: AgentCatalog = { version: 1, agents: [agentConfig("a1"), agentConfig("a2")] };
	const registry = buildRegistry(catalog, [ACCOUNT]);
	const threads = new ThreadStore(db.db);
	const messages = new MessageStore(db.db);
	const readState = new AgentReadStateStore(db.db);
	const queue = new QueueLedgerStore(db.db);
	const records = new InvocationRecordStore(db.db);
	const turns = new TurnExecutionStore(db.db);
	const attempts = new InvocationAttemptStore(db.db);
	const sessions = new AgentSessionStore(db.db);
	const credentials = new InvocationCredentialStore(db.db);
	const drafts = new ResponseDraftStore(db.db);
	const tracker = new InvocationTracker();
	let clockNow = 1000;
	const clock = (): number => clockNow;
	const ingress = new OperatorMessageIngress({ db: db.db, registry, threads, messages, queue });
	const invoker = new InvokeSingleAgent({
		db: db.db,
		attempts,
		turns,
		credentials,
		drafts,
		messages,
		queue,
		sessions,
		clock,
	});

	const makeProcessor = (
		run: (input: AgentTurnInput) => Promise<AgentTurnCompletion>,
		assemble?: AssembleContext,
		log?: (level: string, event: string, fields?: Record<string, unknown>) => void,
	): QueueProcessor => {
		const router = new AgentRouter({
			assemble: assemble ?? (() => ({ window: { mode: "bootstrap", rows: [], boundarySeq: 0 }, prompt: "" })),
			runner: { run },
			committer: { commit: () => undefined },
			...(log ? { log } : {}),
		});
		return new QueueProcessor({
			db: db.db,
			registry,
			queue,
			records,
			turns,
			attempts,
			sessions,
			messages,
			threads,
			tracker,
			router,
			credentials,
			drafts,
			clock,
		});
	};

	const processor = makeProcessor(async (input) => {
		invoker.begin(input.prepared);
		return completion(input.prepared);
	});

	return {
		dir,
		db: db.db,
		registry,
		threads,
		messages,
		readState,
		queue,
		records,
		turns,
		attempts,
		sessions,
		credentials,
		drafts,
		tracker,
		ingress,
		invoker,
		processor,
		makeProcessor,
		advance: (ms: number) => {
			clockNow += ms;
		},
	};
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("F044b Phase B ownership", () => {
	it("invoke-single-agent appends the whole Phase B chain inside the route runner", async () => {
		const w = makeWorld();
		const submitted = w.ingress.submit({ threadId: "t1", userId: "u1", body: "go @a1", now: 10 });

		const result = await w.processor.drain("t1", "u1");
		expect(result.processed).toBe(1);
		expect(result.convergenceFailed).toEqual([]);

		const invocationId = `inv:t1:${submitted.message.id}`;
		const attempt = w.attempts.getLatest(invocationId, "a1")!;
		expect(attempt.deliveryState).toBe("appended");
		expect(attempt.settlement).toBe("streaming");
		expect(w.turns.get(attempt.turnExecutionId!)?.status).toBe("running");
		expect(w.credentials.getByTurn(attempt.turnExecutionId!)?.state).toBe("active");
		expect(w.drafts.getByTurn(attempt.turnExecutionId!)?.attemptId).toBe(attempt.attemptId);
		expect(w.messages.get(`resp:${attempt.turnExecutionId}`)?.lifecycle?.kind).toBe("response");

		const input = w.messages.get(submitted.message.id)!;
		if (input.lifecycle?.kind === "input") {
			expect(input.lifecycle.dispatchRefs[0]?.turnExecutionId).toBe(attempt.turnExecutionId);
		}
		expect(w.queue.listQueued("t1")).toHaveLength(0);
	});

	it("Phase B failure is a typed prestart failure; the processor does not re-converge it", async () => {
		const w = makeWorld();
		const submitted = w.ingress.submit({ threadId: "t1", userId: "u1", body: "go @a1", now: 10 });
		vi.spyOn(w.drafts, "create").mockImplementationOnce(() => {
			throw new Error("draft boom");
		});

		const result = await w.processor.drain("t1", "u1");
		expect(result.processed).toBe(1);
		expect(result.convergenceFailed).toEqual([]);

		const invocationId = `inv:t1:${submitted.message.id}`;
		const attempt = w.attempts.getLatest(invocationId, "a1")!;
		expect(attempt.deliveryState).toBe("failed");
		expect(attempt.terminalReason).toBe("phase_b_failed");
		expect(attempt.turnExecutionId).toBeNull();
		expect(w.turns.listByInvocation(invocationId)).toHaveLength(0);
		expect(w.messages.get(`resp:te:${attempt.attemptId}`)).toBeNull();

		const failures = w.messages.getByThread("t1", 50).filter((m) => m.lifecycle?.kind === "delivery_failure");
		expect(failures).toHaveLength(1);
		expect(failures[0]!.lifecycle).toMatchObject({ kind: "delivery_failure", reason: "draft_create_failed" });
		expect(failures[0]!.content).toContain("draft boom");

		// The target was never retired: it stays pending for the bounded retry.
		expect(w.queue.listQueued("t1")).toHaveLength(1);
	});

	it("retries a Phase B-failed target on the next eligible drain (attempt 2)", async () => {
		const w = makeWorld();
		const submitted = w.ingress.submit({ threadId: "t1", userId: "u1", body: "go @a1", now: 10 });
		vi.spyOn(w.drafts, "create").mockImplementationOnce(() => {
			throw new Error("draft boom once");
		});

		await w.processor.drain("t1", "u1");
		const invocationId = `inv:t1:${submitted.message.id}`;
		expect(w.attempts.getLatest(invocationId, "a1")?.attempt).toBe(1);
		expect(w.attempts.getLatest(invocationId, "a1")?.deliveryState).toBe("failed");
		// Still retryable: the parent must not collapse to terminal.
		expect(w.records.get(invocationId)?.status).toBe("running");

		w.advance(600_000);
		const retried = await w.processor.drain("t1", "u1");
		expect(retried.processed).toBe(1);
		expect(retried.convergenceFailed).toEqual([]);
		const attempt = w.attempts.getLatest(invocationId, "a1")!;
		expect(attempt.attempt).toBe(2);
		expect(attempt.deliveryState).toBe("appended");
		expect(w.turns.get(attempt.turnExecutionId!)?.status).toBe("running");
	});

	it("keeps the bounded backoff after a provider-phase failure (no hot retry)", async () => {
		const w = makeWorld();
		const submitted = w.ingress.submit({ threadId: "t1", userId: "u1", body: "go @a1", now: 10 });
		const processor = w.makeProcessor(async (input) => {
			w.invoker.begin(input.prepared);
			throw new Error("provider boom");
		});

		const first = await processor.drain("t1", "u1");
		expect(first.processed).toBe(1);
		const invocationId = `inv:t1:${submitted.message.id}`;
		const failed = w.attempts.getLatest(invocationId, "a1")!;
		expect(failed.attempt).toBe(1);
		expect(failed.deliveryState).toBe("failed");
		expect(failed.terminalReason).toBe("provider_phase_failed");

		// Provider failure still has its own attempt budget; the reset on Phase B
		// success must not erase the backoff set by convergence.
		await processor.drain("t1", "u1");
		expect(w.attempts.getLatest(invocationId, "a1")?.attempt).toBe(1);

		w.advance(20_000);
		await processor.drain("t1", "u1");
		expect(w.attempts.getLatest(invocationId, "a1")?.attempt).toBe(2);
	});

	it("route assembly failure fails the target prestart and leaves the healthy sibling in Phase B", async () => {
		const w = makeWorld();
		const submitted = w.ingress.submit({ threadId: "t1", userId: "u1", body: "both @a1 @a2", now: 10 });
		const processor = w.makeProcessor(
			async (input) => {
				w.invoker.begin(input.prepared);
				return completion(input.prepared);
			},
			(prepared) => {
				if (prepared.agentId === "a2") throw new Error("history boom");
				return { window: { mode: "bootstrap", rows: [], boundarySeq: 0 }, prompt: "" };
			},
		);

		const result = await processor.drain("t1", "u1");
		expect(result.processed).toBe(1);
		expect(result.convergenceFailed).toEqual([]);

		const invocationId = `inv:t1:${submitted.message.id}`;
		const healthy = w.attempts.getLatest(invocationId, "a1")!;
		expect(healthy.deliveryState).toBe("appended");
		expect(w.turns.get(healthy.turnExecutionId!)?.status).toBe("running");

		const failed = w.attempts.getLatest(invocationId, "a2")!;
		expect(failed.deliveryState).toBe("failed");
		expect(failed.terminalReason).toBe("phase_b_failed");
		expect(failed.turnExecutionId).toBeNull();
		const failures = w.messages.getByThread("t1", 50).filter((m) => m.lifecycle?.kind === "delivery_failure");
		expect(failures).toHaveLength(1);
		expect(failures[0]!.content).toContain("history boom");
		// a2 stays pending; a1 retired.
		const queued = w.queue.listQueued("t1");
		expect(queued).toHaveLength(1);
		expect(queued[0]!.targets.map((target) => target.id)).toEqual(["a2"]);
	});

	it("a null runner completion is a route error, not a silent skip (P3-a)", async () => {
		const prepared = { agentId: "a1" } as PreparedDispatch;
		const router = new AgentRouter({
			assemble: () => ({ window: { mode: "bootstrap", rows: [], boundarySeq: 0 }, prompt: "" }),
			runner: { run: async () => null as unknown as AgentTurnCompletion },
			committer: { commit: () => undefined },
		});

		const routed = await router.routeAgents([prepared], "serial");
		expect(routed.results).toEqual([]);
		expect(routed.errors).toHaveLength(1);
		expect(String(routed.errors[0]!.error)).toContain("turn_runner_returned_null");
		expect(routed.errors[0]!.stage).toBe("run");
	});

	it("a carrier-release failure does not turn a completed T1 into a route error", async () => {
		const logged: string[] = [];
		const prepared = { agentId: "a1" } as PreparedDispatch;
		const router = new AgentRouter({
			assemble: () => ({ window: { mode: "bootstrap", rows: [], boundarySeq: 0 }, prompt: "" }),
			runner: {
				async run(input) {
					return {
						...completion(input.prepared),
						release: async () => {
							throw new Error("release boom");
						},
					};
				},
			},
			committer: { commit: () => undefined },
			log: (_level, event) => logged.push(event),
		});

		const routed = await router.routeAgents([prepared], "serial");
		expect(routed.errors).toEqual([]);
		expect(routed.results).toHaveLength(1);
		expect(logged).toContain("route_carrier_release_failed");
	});

	it("a T2 commit failure is observable through the route log hook (P3-c)", async () => {
		const logged: Array<{ event: string; fields: Record<string, unknown> | undefined }> = [];
		const prepared = { agentId: "a1" } as PreparedDispatch;
		const router = new AgentRouter({
			assemble: () => ({ window: { mode: "bootstrap", rows: [], boundarySeq: 0 }, prompt: "" }),
			runner: { run: async (input) => completion(input.prepared) },
			committer: {
				commit: () => {
					throw new Error("t2 transient");
				},
			},
			log: (_level, event, fields) => logged.push({ event, fields }),
		});

		const routed = await router.routeAgents([prepared], "serial");
		expect(routed.errors).toEqual([]);
		expect(routed.results).toHaveLength(1);
		expect(logged.some((entry) => entry.event === "route_t2_commit_failed")).toBe(true);
	});
});
