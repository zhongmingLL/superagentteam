import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccountConfig, AgentCatalog, AgentConfig, QueueEntry } from "@superagentteam/shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OperatorMessageIngress } from "../src/domains/a2a/ingress/router.ts";
import { type AgentRegistry, buildRegistry } from "../src/domains/agents/registry.ts";
import { AgentReadStateStore, MessageStore } from "../src/domains/messages/store.ts";
import { QueueLedgerStore } from "../src/domains/queue/ledger/store.ts";
import { SteerRegistry } from "../src/domains/queue/steer/registry.ts";
import { SteerService } from "../src/domains/queue/steer/service.ts";
import { InvocationTracker } from "../src/domains/queue/tracker/index.ts";
import { ThreadStore } from "../src/domains/threads/store.ts";
import { F018Database } from "../src/infrastructure/db/database.ts";

const dirs: string[] = [];
const ACCOUNT: AccountConfig = { ref: "main", provider: "pi", apiKeyRef: "KEY", models: ["m1"] };

function agentConfig(id: string): AgentConfig {
	return {
		id,
		mentionPatterns: [`@${id}`],
		displayName: `Agent ${id}`,
		contextWindow: 128_000,
		roleId: "worker",
		roleDescription: "F053 steer tests",
		restrictions: [],
		strengths: [],
		accountRef: "main",
		defaultModel: "m1",
		sessionChain: true,
		enabled: true,
	};
}

function registry(): AgentRegistry {
	const catalog: AgentCatalog = { version: 1, agents: [agentConfig("a1"), agentConfig("a2")] };
	return buildRegistry(catalog, [ACCOUNT]);
}

interface World {
	db: F018Database;
	threads: ThreadStore;
	messages: MessageStore;
	queue: QueueLedgerStore;
	tracker: InvocationTracker;
	steerRegistry: SteerRegistry;
	service: SteerService;
	processEntry: ReturnType<typeof vi.fn>;
	entry: QueueEntry;
	messageId: string;
}

function makeWorld(): World {
	const dir = mkdtempSync(join(tmpdir(), "f053-steer-"));
	dirs.push(dir);
	const db = new F018Database({ path: join(dir, "f018.db") });
	db.db
		.prepare(
			"INSERT INTO threads (id, project_path, created_by, last_active_at, created_at, updated_at) VALUES ('t1', '/p', 'u1', 1, 1, 1)",
		)
		.run();
	const agents = registry();
	const threads = new ThreadStore(db.db);
	const messages = new MessageStore(db.db);
	const readState = new AgentReadStateStore(db.db);
	const queue = new QueueLedgerStore(db.db);
	const ingress = new OperatorMessageIngress({
		db: db.db,
		registry: agents,
		threads,
		messages,
		queue,
	});
	const submitted = ingress.submit({ threadId: "t1", userId: "u1", body: "steer this @a1", now: 10 });
	const entry = queue.listQueued("t1")[0]!;
	const tracker = new InvocationTracker(() => 1_000);
	const steerRegistry = new SteerRegistry();
	const processEntry = vi.fn(async () => ({
		outcome: "dispatched" as const,
		parentInvocationId: `inv:t1:${submitted.message.id}`,
		dispatched: ["a1"],
		invalid: [],
	}));
	const service = new SteerService({
		threads,
		queue,
		messages,
		tracker,
		registry: steerRegistry,
		processor: { processEntry },
		clock: () => 1_000,
		newClaimId: () => "steer:test",
	});
	void readState;
	return {
		db,
		threads,
		messages,
		queue,
		tracker,
		steerRegistry,
		service,
		processEntry,
		entry,
		messageId: submitted.message.id,
	};
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function attachGuide(w: World, steer = vi.fn(async () => ({ disposition: "queued" }))): typeof steer {
	const controller = w.tracker.start("t1", "a1", "u1", "te:f053");
	expect(controller.signal.aborted).toBe(false);
	w.steerRegistry.attach({
		threadId: "t1",
		agentId: "a1",
		turnExecutionId: "te:f053",
		attempt: 1,
		steer,
	});
	return steer;
}

describe("F053 SteerService", () => {
	it("guides a queued target into the exact active turn without cancelling it", async () => {
		const w = makeWorld();
		const steer = attachGuide(w);

		const result = await w.service.steer({
			threadId: "t1",
			queueEntryId: w.entry.queueEntryId,
			targetAgentId: "a1",
			mode: "guide",
			userId: "u1",
		});

		expect(result).toEqual({ outcome: "guided", targetAgentId: "a1", disposition: "queued" });
		expect(steer).toHaveBeenCalledWith("steer this @a1");
		expect(w.tracker.has("t1", "a1")).toBe(true);
		expect(w.queue.listQueued("t1")).toHaveLength(0);
		const message = w.messages.get(w.messageId);
		expect(message?.lifecycle?.kind).toBe("input");
		if (message?.lifecycle?.kind === "input") {
			expect(message.lifecycle.dispatchRefs).toEqual([
				expect.objectContaining({
					target: { kind: "agent", id: "a1" },
					queueEntryId: w.entry.queueEntryId,
					attempt: 1,
					turnExecutionId: "te:f053",
					phase: "dispatched",
				}),
			]);
		}
	});

	it("rejects guide without an exact active turn and releases the claim", async () => {
		const w = makeWorld();

		const result = await w.service.steer({
			threadId: "t1",
			queueEntryId: w.entry.queueEntryId,
			targetAgentId: "a1",
			mode: "guide",
			userId: "u1",
		});

		expect(result).toMatchObject({ outcome: "rejected", code: "no_active_turn" });
		const entry = w.queue.get("t1", w.entry.queueEntryId);
		expect(entry?.status).toBe("queued");
		expect(entry?.claim).toBeNull();
	});

	it("interrupts the active turn, promotes the entry and starts the same target", async () => {
		const w = makeWorld();
		w.tracker.start("t1", "a1", "u1", "te:old");

		const result = await w.service.steer({
			threadId: "t1",
			queueEntryId: w.entry.queueEntryId,
			targetAgentId: "a1",
			mode: "interrupt",
			userId: "u1",
		});

		expect(result).toMatchObject({ outcome: "started", targetAgentId: "a1", dispatched: ["a1"] });
		expect(w.tracker.has("t1", "a1")).toBe(false);
		expect(w.queue.get("t1", w.entry.queueEntryId)?.priority).toBe("urgent");
		expect(w.processEntry).toHaveBeenCalledTimes(1);
		const [entry, claimId, userId] = w.processEntry.mock.calls[0]!;
		expect((entry as QueueEntry).claim?.targetKeys).toEqual(["agent:a1"]);
		expect(claimId).toBe("steer:test");
		expect(userId).toBe("u1");
	});

	it("interrupts an idle target and starts it directly", async () => {
		const w = makeWorld();

		const result = await w.service.steer({
			threadId: "t1",
			queueEntryId: w.entry.queueEntryId,
			targetAgentId: "a1",
			mode: "interrupt",
			userId: "u1",
		});

		expect(result).toMatchObject({ outcome: "started", targetAgentId: "a1" });
		expect(w.processEntry).toHaveBeenCalledTimes(1);
	});

	it("rejects a claimed entry and a foreign user", async () => {
		const w = makeWorld();
		expect(
			w.queue.claim("t1", w.entry.queueEntryId, {
				claimId: "another",
				owner: "queue",
				ttlMs: 10_000,
				targetKeys: ["agent:a1"],
				now: 2_000,
			}).outcome,
		).toBe("claimed");
		const claimed = await w.service.steer({
			threadId: "t1",
			queueEntryId: w.entry.queueEntryId,
			targetAgentId: "a1",
			mode: "interrupt",
			userId: "u1",
		});
		expect(claimed).toMatchObject({ outcome: "rejected", code: "entry_processing" });

		const w2 = makeWorld();
		const foreign = await w2.service.steer({
			threadId: "t1",
			queueEntryId: w2.entry.queueEntryId,
			targetAgentId: "a1",
			mode: "guide",
			userId: "u2",
		});
		expect(foreign).toMatchObject({ outcome: "rejected", code: "forbidden" });
	});
});
