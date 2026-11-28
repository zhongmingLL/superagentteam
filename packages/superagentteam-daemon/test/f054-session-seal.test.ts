import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { MessageStore } from "../src/domains/messages/store.ts";
import { QueueLedgerStore } from "../src/domains/queue/ledger/store.ts";
import { InvocationTracker } from "../src/domains/queue/tracker/index.ts";
import { SessionArtifactStore } from "../src/domains/sessions/artifacts.ts";
import { SessionSealService } from "../src/domains/sessions/seal-service.ts";
import { AgentSessionStore } from "../src/domains/sessions/store.ts";
import { ThreadStore } from "../src/domains/threads/store.ts";
import { F018Database } from "../src/infrastructure/db/database.ts";

const dirs: string[] = [];

interface World {
	db: F018Database;
	threads: ThreadStore;
	messages: MessageStore;
	sessions: AgentSessionStore;
	artifacts: SessionArtifactStore;
	queue: QueueLedgerStore;
	tracker: InvocationTracker;
	service: SessionSealService;
}

function makeWorld(): World {
	const dir = mkdtempSync(join(tmpdir(), "f054-seal-"));
	dirs.push(dir);
	const db = new F018Database({ path: join(dir, "f018.db") });
	db.db
		.prepare(
			"INSERT INTO threads (id, project_path, created_by, last_active_at, created_at, updated_at) VALUES ('t1', '/p', 'u1', 1, 1, 1)",
		)
		.run();
	const threads = new ThreadStore(db.db);
	const messages = new MessageStore(db.db);
	const sessions = new AgentSessionStore(db.db);
	const artifacts = new SessionArtifactStore(db.db);
	const queue = new QueueLedgerStore(db.db);
	const tracker = new InvocationTracker(() => 1_000);
	const service = new SessionSealService({
		db: db.db,
		threads,
		sessions,
		artifacts,
		messages,
		tracker,
		queue,
		clock: () => 2_000,
	});
	return { db, threads, messages, sessions, artifacts, queue, tracker, service };
}

function append(
	w: World,
	id: string,
	from: { kind: "user"; userId: string } | { kind: "agent"; agentId: string },
	content: string,
	now: number,
	lifecycle?: Parameters<MessageStore["append"]>[0]["lifecycle"],
): void {
	w.messages.append({ id, threadId: "t1", from, content, now, ...(lifecycle ? { lifecycle } : {}) });
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("F054 session chain + full seal", () => {
	it("seals an idle active session with a transcript and deterministic digest", () => {
		const w = makeWorld();
		const session = w.sessions.ensureActive({
			threadId: "t1",
			agentId: "a1",
			userId: "u1",
			workingDirectory: "/p",
			now: 1_000,
		});
		append(w, "m1", { kind: "user", userId: "u1" }, "please inspect", 1_100);
		append(w, "m2", { kind: "agent", agentId: "a1" }, "inspected", 1_200, {
			kind: "response",
			parentInvocationId: "inv:1",
			turnExecutionId: "te:1",
			target: { kind: "agent", id: "a1" },
			status: "completed",
			startedAt: 1_150,
			endedAt: 1_200,
		});
		append(w, "m3", { kind: "user", userId: "u1" }, "now fix it", 1_300);
		append(w, "m4", { kind: "agent", agentId: "a1" }, "failed while fixing", 1_400, {
			kind: "response",
			parentInvocationId: "inv:2",
			turnExecutionId: "te:2",
			target: { kind: "agent", id: "a1" },
			status: "failed",
			startedAt: 1_350,
			endedAt: 1_400,
		});

		const result = w.service.seal(session.id, "u1", "manual");
		expect(result.outcome).toBe("sealed");
		if (result.outcome !== "sealed") return;
		expect(result.session.status).toBe("sealed");
		expect(result.session.sealReason).toBe("manual");
		expect(result.artifact.fromSeq).toBe(1);
		expect(result.artifact.toSeq).toBe(4);
		expect(result.artifact.messageCount).toBe(4);
		expect(result.artifact.transcript.map((entry) => entry.content)).toEqual([
			"please inspect",
			"inspected",
			"now fix it",
			"failed while fixing",
		]);
		expect(result.artifact.digest.senders).toEqual({ user: 2, agents: { a1: 2 }, system: 0 });
		expect(result.artifact.digest.errors.count).toBe(1);
		expect(result.artifact.digest.firstUserMessage).toBe("please inspect");
		expect(result.artifact.digest.lastUserMessage).toBe("now fix it");
		expect(result.artifact.digest.lastAgentMessage).toBe("failed while fixing");

		const chain = w.service.chain("t1", "u1");
		expect("sessions" in chain && chain.sessions[0]).toMatchObject({
			id: session.id,
			status: "sealed",
			hasArtifact: true,
		});
		const detail = w.service.detail(session.id, "u1");
		expect("artifact" in detail && detail.artifact?.messageCount).toBe(4);
		const transcript = w.service.transcript(session.id, "u1");
		expect("transcript" in transcript && transcript.transcript).toHaveLength(4);
	});

	it("starts the next window after the previous sealed toSeq and creates seq+1", () => {
		const w = makeWorld();
		const first = w.sessions.ensureActive({
			threadId: "t1",
			agentId: "a1",
			userId: "u1",
			workingDirectory: "/p",
			now: 1_000,
		});
		append(w, "m1", { kind: "user", userId: "u1" }, "one", 1_100);
		const firstSeal = w.service.seal(first.id, "u1");
		expect(firstSeal.outcome).toBe("sealed");

		const second = w.sessions.ensureActive({
			threadId: "t1",
			agentId: "a1",
			userId: "u1",
			workingDirectory: "/p",
			now: 2_000,
		});
		expect(second.seq).toBe(1);
		expect(second.status).toBe("active");
		append(w, "m2", { kind: "user", userId: "u1" }, "two", 2_100);
		const secondSeal = w.service.seal(second.id, "u1");
		expect(secondSeal.outcome).toBe("sealed");
		if (secondSeal.outcome !== "sealed") return;
		expect(secondSeal.artifact.fromSeq).toBe(2);
		expect(secondSeal.artifact.toSeq).toBe(2);
		expect(secondSeal.artifact.transcript.map((entry) => entry.content)).toEqual(["two"]);
	});

	it("rejects running and queued work, foreign users and non-active sessions", () => {
		const w = makeWorld();
		const session = w.sessions.ensureActive({
			threadId: "t1",
			agentId: "a1",
			userId: "u1",
			workingDirectory: "/p",
			now: 1_000,
		});
		w.tracker.start("t1", "a1", "u1", "te:running");
		expect(w.service.seal(session.id, "u1")).toMatchObject({
			outcome: "rejected",
			code: "session_active_invocation",
		});
		w.tracker.cancel("t1", "a1");

		w.queue.enqueue({
			threadId: "t1",
			sourceRecordId: "src:queued",
			messageId: null,
			owner: { kind: "user", userId: "u1" },
			kind: "conversation_input",
			from: { kind: "user", userId: "u1" },
			content: "queued",
			targets: [{ kind: "agent", id: "a1" }],
		});
		expect(w.service.seal(session.id, "u1")).toMatchObject({ outcome: "rejected", code: "session_busy" });
		w.queue.deleteEntry("t1", w.queue.listQueued("t1")[0]!.queueEntryId);

		expect(w.service.seal(session.id, "u2")).toMatchObject({ outcome: "rejected", code: "forbidden" });
		w.sessions.sealActive(session.id, "lightweight", 1_500);
		expect(w.service.seal(session.id, "u1")).toMatchObject({
			outcome: "rejected",
			code: "session_not_active",
		});
		const lightweight = w.service.transcript(session.id, "u1");
		expect(lightweight).toMatchObject({ outcome: "rejected", code: "session_artifact_not_found" });
	});

	it("truncates long windows but keeps the latest entries", { timeout: 20_000 }, () => {
		const w = makeWorld();
		const session = w.sessions.ensureActive({
			threadId: "t1",
			agentId: "a1",
			userId: "u1",
			workingDirectory: "/p",
			now: 1_000,
		});
		for (let index = 0; index < 405; index += 1) {
			append(w, `m${index}`, { kind: "user", userId: "u1" }, `message ${index}`, 1_100 + index);
		}
		const result = w.service.seal(session.id, "u1");
		expect(result.outcome).toBe("sealed");
		if (result.outcome !== "sealed") return;
		expect(result.artifact.messageCount).toBe(400);
		expect(result.artifact.fromSeq).toBe(6);
		expect(result.artifact.toSeq).toBe(405);
		expect(result.artifact.digest.window.truncated).toBe(true);
		expect(result.artifact.transcript[0]?.content).toBe("message 5");
		expect(result.artifact.transcript.at(-1)?.content).toBe("message 404");
	});
});
