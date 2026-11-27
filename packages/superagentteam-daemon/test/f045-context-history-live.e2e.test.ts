import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccountConfig, AgentCatalog, AgentConfig } from "@superagentteam/shared/types";
import { afterEach, describe, expect, it } from "vitest";

import { buildA2ARuntime } from "../src/app/a2a-runtime.ts";
import { buildRegistry } from "../src/domains/agent/registry.ts";
import { PiWorkerSpawnPort } from "../src/domains/worker/pi-spawn.ts";
import { F018Database } from "../src/infrastructure/db/database.ts";

// F045 AC-E2E (operator 2026-11-27/28): the F044 method also applies to
// context/history. This is the P layer: real pi worker + real provider.
// Run with:
//   set -a; source ~/.config/superagentteam/runtime.env; set +a
//   SUPERAGENTTEAM_LIVE_PROVIDER=1 \
//   SUPERAGENTTEAM_LIVE_PROVIDER_ID=kimi-coding \
//   SUPERAGENTTEAM_LIVE_API_KEY_REF=KIMI_API_KEY \
//   SUPERAGENTTEAM_LIVE_MODEL=kimi-for-coding \
//     npx vitest --run test/f045-context-history-live.e2e.test.ts

const liveProvider = process.env.SUPERAGENTTEAM_LIVE_PROVIDER_ID ?? "kimi-coding";
const liveApiKeyRef = process.env.SUPERAGENTTEAM_LIVE_API_KEY_REF ?? "KIMI_API_KEY";
const liveEnabled = process.env.SUPERAGENTTEAM_LIVE_PROVIDER === "1" && Boolean(process.env[liveApiKeyRef]);
const liveModel = process.env.SUPERAGENTTEAM_LIVE_MODEL ?? "kimi-for-coding";
const REAL_CLI_PATH = join(import.meta.dirname, "..", "..", "coding-agent", "dist", "cli.js");

const dirs: string[] = [];

function agentConfig(id: string): AgentConfig {
	return {
		id,
		mentionPatterns: [`@${id}`],
		displayName: `Agent ${id}`,
		contextWindow: 128_000,
		roleId: "worker",
		roleDescription: "F045 live context/history E2E",
		restrictions: [],
		strengths: [],
		accountRef: "live",
		defaultModel: liveModel,
		sessionChain: true,
		enabled: true,
	};
}

function makeWorld(agentIds: readonly string[]): {
	runtime: ReturnType<typeof buildA2ARuntime>;
	logs: Array<{ event: string; fields: Record<string, unknown> | undefined }>;
} {
	const dir = mkdtempSync(join(tmpdir(), "f045-live-"));
	dirs.push(dir);
	const projectPath = join(dir, "project");
	mkdirSync(projectPath, { recursive: true });
	const db = new F018Database({ path: join(dir, "f045-live.db") });
	db.db
		.prepare(
			"INSERT INTO threads (id, project_path, title, created_by, last_active_at, created_at, updated_at) VALUES ('t1', ?, 'F045 live', 'u1', 1, 1, 1)",
		)
		.run(projectPath);
	const catalog: AgentCatalog = { version: 1, agents: agentIds.map(agentConfig) };
	const account: AccountConfig = {
		ref: "live",
		provider: liveProvider,
		apiKeyRef: liveApiKeyRef,
		models: [liveModel],
	};
	const logs: Array<{ event: string; fields: Record<string, unknown> | undefined }> = [];
	const runtime = buildA2ARuntime({
		db: db.db,
		registry: buildRegistry(catalog, [account]),
		spawn: new PiWorkerSpawnPort({
			cliPath: REAL_CLI_PATH,
			sessionDir: join(dir, "sessions"),
			workerAgentDir: join(dir, "agent"),
			offline: true,
		}),
		clock: Date.now,
		processStartedAt: 1,
		promptTimeoutMs: 120_000,
		log: (_level, event, fields) => logs.push({ event, fields }),
	});
	return { runtime, logs };
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!liveEnabled)("F045 context/history live provider E2E", () => {
	it("real provider: parallel targets share the trigger boundary and keep sibling replies invisible", async () => {
		const { runtime, logs } = makeWorld(["a1", "b1"]);
		const submitted = runtime.ingress.submit({
			threadId: "t1",
			userId: "u1",
			body: "@a1 @b1 各自请只回复：<你的 agent id>_LIVE_OK（不要回复其他内容）",
			now: 10,
		});
		const drained = await runtime.processor.drain("t1", "u1");
		expect(drained.processed).toBe(1);

		const invocationId = `inv:t1:${submitted.message.id}`;
		expect(runtime.records.get(invocationId)?.status).toBe("completed");
		const a = runtime.attempts.getLatest(invocationId, "a1")!;
		const b = runtime.attempts.getLatest(invocationId, "b1")!;
		const aMessage = runtime.messages.get(a.responseMessageId!)!;
		const bMessage = runtime.messages.get(b.responseMessageId!)!;
		expect(aMessage.content).toContain("a1_LIVE_OK");
		expect(bMessage.content).toContain("b1_LIVE_OK");
		expect(aMessage.content).not.toContain("b1_LIVE_OK");
		expect(bMessage.content).not.toContain("a1_LIVE_OK");

		const trigger = runtime.messages.get(submitted.message.id)!;
		expect(a.deliveryBoundarySeq).toBe(trigger.seq);
		expect(b.deliveryBoundarySeq).toBe(trigger.seq);
		const assembled = logs.filter((entry) => entry.event === "route_context_assembled");
		expect(assembled.find((entry) => entry.fields?.agent_id === "a1")?.fields?.boundary_seq).toBe(trigger.seq);
		expect(assembled.find((entry) => entry.fields?.agent_id === "b1")?.fields?.boundary_seq).toBe(trigger.seq);
		if (process.env.SUPERAGENTTEAM_E2E_TRACE === "1") {
			console.info(`[f045-live:c1] trigger_seq=${trigger.seq} a1="${aMessage.content}" b1="${bMessage.content}"`);
		}
	}, 180_000);

	it("real provider: a post_message source below the cursor is still visible in the prompt", async () => {
		const { runtime, logs } = makeWorld(["a1", "b1"]);
		const seededAt = Date.now();
		const source = runtime.messages.append({
			id: "msg:f045-live:source",
			threadId: "t1",
			from: { kind: "agent", agentId: "a1" },
			content: "请只回复：LIVE_SOURCE_BELOW_CURSOR",
			lifecycle: { kind: "input", dispatchRefs: [] },
			extra: { targetAgentIds: ["b1"] },
			now: seededAt,
		});
		const laterOne = runtime.messages.append({
			id: "msg:f045-live:later-one",
			threadId: "t1",
			from: { kind: "user", userId: "u1" },
			content: "LATER_LIVE_ONE",
			lifecycle: { kind: "input", dispatchRefs: [] },
			now: seededAt + 1,
		});
		const laterTwo = runtime.messages.append({
			id: "msg:f045-live:later-two",
			threadId: "t1",
			from: { kind: "user", userId: "u1" },
			content: "LATER_LIVE_TWO",
			lifecycle: { kind: "input", dispatchRefs: [] },
			now: seededAt + 2,
		});
		runtime.readState.ack("t1", "b1", laterTwo.seq, seededAt + 3);
		expect(source.seq).toBeLessThan(laterOne.seq);

		const enqueued = runtime.queue.enqueue({
			threadId: "t1",
			sourceRecordId: source.id,
			messageId: source.id,
			attempt: 1,
			owner: { kind: "system", service: "a2a" },
			kind: "message_wake",
			from: { kind: "agent", agentId: "a1" },
			content: source.content,
			targets: [{ kind: "agent", id: "b1" }],
			execution: {
				a2aParentTurnExecutionId: null,
				a2aTriggerMessageId: source.id,
				a2aDepth: 1,
				multiMentionRequestId: null,
				multiMentionCallbackDepth: null,
			},
		});
		expect(enqueued.outcome).toBe("enqueued");

		const drained = await runtime.processor.drain("t1", "u1");
		expect(drained.processed).toBe(1);
		const invocationId = `inv:t1:${source.id}`;
		expect(runtime.records.get(invocationId)?.status).toBe("completed");
		const attempt = runtime.attempts.getLatest(invocationId, "b1")!;
		expect(runtime.messages.get(attempt.responseMessageId!)?.content).toContain("LIVE_SOURCE_BELOW_CURSOR");
		expect(attempt.deliveryBoundarySeq).toBe(laterTwo.seq);
		const assembled = logs.filter((entry) => entry.event === "route_context_assembled");
		expect(assembled).toHaveLength(1);
		expect(assembled[0]!.fields).toMatchObject({
			agent_id: "b1",
			mode: "incremental",
			boundary_seq: laterTwo.seq,
			row_count: 1,
			source_record_id: source.id,
		});
		if (process.env.SUPERAGENTTEAM_E2E_TRACE === "1") {
			console.info(
				`[f045-live:c2] source_seq=${source.seq} boundary_seq=${attempt.deliveryBoundarySeq} reply="${runtime.messages.get(attempt.responseMessageId!)?.content}"`,
			);
		}
	}, 180_000);
});
