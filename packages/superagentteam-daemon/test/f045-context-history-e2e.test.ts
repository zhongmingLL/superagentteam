import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccountConfig, AgentCatalog, AgentConfig } from "@superagentteam/shared/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createConsoleToken } from "../src/api/console-link.ts";
import { initOperatorCredential } from "../src/auth/operator.ts";
import { type DaemonHandle, startDaemon } from "../src/index.ts";
import { errorResponse, startMockAnthropic, textResponse } from "./helpers/mock-anthropic.ts";

const HUB_ORIGIN = "http://localhost:3000";
const PI_CLI_PATH = join(import.meta.dirname, "..", "..", "coding-agent", "dist", "cli.js");

function agentConfig(id: string, model: string): AgentConfig {
	return {
		id,
		mentionPatterns: [`@${id}`],
		displayName: `Agent ${id}`,
		contextWindow: 16_384,
		roleId: "worker",
		roleDescription: "F045 context/history E2E",
		restrictions: [],
		strengths: [],
		accountRef: "main",
		defaultModel: model,
		sessionChain: true,
		enabled: true,
	};
}

function writeWorkerModels(agentDir: string, baseUrl: string): void {
	mkdirSync(agentDir, { recursive: true, mode: 0o700 });
	writeFileSync(
		join(agentDir, "models.json"),
		JSON.stringify({
			providers: {
				mock: {
					baseUrl,
					api: "anthropic-messages",
					apiKey: "test",
					models: [
						{ id: "a-model", name: "a-model", contextWindow: 16_384, maxTokens: 1_024 },
						{ id: "b-model", name: "b-model", contextWindow: 16_384, maxTokens: 1_024 },
					],
				},
			},
		}),
	);
}

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(check: () => Promise<T | null> | T | null, timeoutMs = 30_000): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = await check();
		if (value !== null) return value;
		await sleep(100);
	}
	throw new Error("timed out waiting for F045 context/history E2E state");
}

function routeContextLogs(handle: DaemonHandle): Array<{ event: string; fields: Record<string, unknown> }> {
	const entries = handle.observability.logs?.tail({ limit: 1_000 }).entries ?? [];
	return entries
		.filter((entry) => entry.event === "route_context_assembled")
		.map((entry) => ({ event: entry.event, fields: entry.fields }));
}

describe("F045 context/history parity E2E", () => {
	let root: string;
	let dataDir: string;
	let installationRoot: string;
	let projectDir: string;
	let daemon: DaemonHandle | null;
	let provider: Awaited<ReturnType<typeof startMockAnthropic>> | null;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "f045-context-e2e-"));
		dataDir = join(root, "data");
		installationRoot = join(root, "install");
		projectDir = join(root, "project");
		mkdirSync(installationRoot);
		mkdirSync(projectDir);
		initOperatorCredential({ dataDir });
		const catalog: AgentCatalog = {
			version: 1,
			agents: [agentConfig("a1", "a-model"), agentConfig("b1", "b-model")],
		};
		const account: AccountConfig = {
			ref: "main",
			provider: "mock",
			apiKeyRef: "KEY",
			models: ["a-model", "b-model"],
		};
		writeFileSync(join(dataDir, "agent-catalog.json"), JSON.stringify(catalog));
		writeFileSync(join(dataDir, "accounts.json"), JSON.stringify([account]));
		daemon = null;
		provider = null;
	});

	afterEach(async () => {
		await daemon?.stop();
		daemon = null;
		await provider?.close();
		provider = null;
		rmSync(root, { recursive: true, force: true });
	});

	async function startStack(): Promise<{
		base: string;
		headers: Record<string, string>;
		thread: { id: string };
	}> {
		if (!provider) throw new Error("mock provider not started");
		writeWorkerModels(join(dataDir, "worker-agent"), provider.baseUrl);
		daemon = await startDaemon({
			installationRoot,
			dataDir,
			runningRevision: "f045-context-history-e2e",
			hubOrigin: HUB_ORIGIN,
			a2aControlPlane: {
				cliPath: PI_CLI_PATH,
				offline: true,
				pollIntervalMs: 50,
				sweepIntervalMs: 1_000,
				promptTimeoutMs: 30_000,
			},
		});
		daemon.markReady();
		const base = new URL(daemon.healthUrl).origin;
		const created = createConsoleToken({ dataDir, ttlMs: 60_000 });
		const exchange = await fetch(`${base}/auth/console?token=${encodeURIComponent(created.token)}`, {
			redirect: "manual",
		});
		const cookie = exchange.headers.get("set-cookie")!.split(";")[0]!;
		const session = (await fetch(`${base}/api/session`, { headers: { cookie } }).then((response) =>
			response.json(),
		)) as { csrfToken: string };
		const headers = {
			cookie,
			"x-csrf-token": session.csrfToken,
			origin: HUB_ORIGIN,
			"content-type": "application/json",
		};
		const response = await fetch(`${base}/api/threads`, {
			method: "POST",
			headers,
			body: JSON.stringify({ projectPath: projectDir, title: "F045 context", idempotencyKey: "f045-thread" }),
		});
		expect(response.status).toBe(201);
		const thread = (await response.json()) as { id: string };
		return { base, headers, thread };
	}

	async function submit(
		base: string,
		headers: Record<string, string>,
		threadId: string,
		content: string,
		idempotencyKey: string,
	): Promise<{ userMessageId: string }> {
		const response = await fetch(`${base}/api/messages`, {
			method: "POST",
			headers,
			body: JSON.stringify({ threadId, content, idempotencyKey }),
		});
		expect(response.status).toBe(202);
		return (await response.json()) as { userMessageId: string };
	}

	it("parallel targets share the trigger snapshot; neither prompt contains a sibling reply", async () => {
		provider = await startMockAnthropic(async (request) => {
			if (request.model === "a-model") {
				await sleep(900);
				return textResponse("A_SLOW_REPLY");
			}
			if (request.model === "b-model") return textResponse("B_FAST_REPLY");
			return errorResponse("unexpected model", 400);
		});
		const { base, headers, thread } = await startStack();
		const submitted = await submit(base, headers, thread.id, "SNAPSHOT_TRIGGER @a1 @b1", "f045-snapshot");
		const invocationId = `inv:${thread.id}:${submitted.userMessageId}`;
		const runtime = daemon!.a2aControlPlane!.runtime;

		await waitFor(() => (runtime.records.get(invocationId)?.status === "completed" ? true : null), 30_000);

		const trigger = runtime.messages.get(submitted.userMessageId)!;
		const aAttempt = runtime.attempts.getLatest(invocationId, "a1")!;
		const bAttempt = runtime.attempts.getLatest(invocationId, "b1")!;
		// Both children captured the same queue-source snapshot, not their own tail.
		expect(aAttempt.deliveryBoundarySeq).toBe(trigger.seq);
		expect(bAttempt.deliveryBoundarySeq).toBe(trigger.seq);
		const assembled = routeContextLogs(daemon!);
		const aAssembled = assembled.find((entry) => entry.fields.agent_id === "a1");
		const bAssembled = assembled.find((entry) => entry.fields.agent_id === "b1");
		expect(aAssembled?.fields.mode).toBe("bootstrap");
		expect(bAssembled?.fields.mode).toBe("bootstrap");
		expect(aAssembled?.fields.boundary_seq).toBe(trigger.seq);
		expect(bAssembled?.fields.boundary_seq).toBe(trigger.seq);
		expect(Number(aAssembled?.fields.row_count)).toBeGreaterThanOrEqual(1);
		expect(Number(bAssembled?.fields.row_count)).toBeGreaterThanOrEqual(1);

		const aPrompts = provider.requests.filter((request) => request.model === "a-model");
		const bPrompts = provider.requests.filter((request) => request.model === "b-model");
		expect(aPrompts.length).toBeGreaterThan(0);
		expect(bPrompts.length).toBeGreaterThan(0);
		for (const request of aPrompts) {
			const body = JSON.stringify(request.body);
			expect(body).toContain("SNAPSHOT_TRIGGER");
			expect(body).not.toContain("B_FAST_REPLY");
		}
		for (const request of bPrompts) {
			const body = JSON.stringify(request.body);
			expect(body).toContain("SNAPSHOT_TRIGGER");
			expect(body).not.toContain("A_SLOW_REPLY");
		}
	}, 60_000);

	it("post_message source below the target cursor stays in the prompt without rewinding ack", async () => {
		provider = await startMockAnthropic((request) => {
			if (request.model === "b-model") return textResponse("B_SOURCE_SEEN");
			return errorResponse("unexpected model", 400);
		});
		const { thread } = await startStack();
		const runtime = daemon!.a2aControlPlane!.runtime;
		const ownerId = runtime.threads.get(thread.id)!.createdBy;
		const seededAt = Date.now();

		// Real-shaped A2A hop: source S from a1 to b1, then two later broadcast
		// messages the target already consumed. The cursor boundary is the
		// precondition; the queue entry below is the exact contract produced by
		// superagentteam_post_message (message_wake + sourceMessageId).
		const source = runtime.messages.append({
			id: "msg:f045:source",
			threadId: thread.id,
			from: { kind: "agent", agentId: "a1" },
			content: "PING_SOURCE_BELOW_CURSOR",
			lifecycle: { kind: "input", dispatchRefs: [] },
			extra: { targetAgentIds: ["b1"] },
			now: seededAt,
		});
		const laterOne = runtime.messages.append({
			id: "msg:f045:later-one",
			threadId: thread.id,
			from: { kind: "user", userId: ownerId },
			content: "LATER_BROADCAST_ONE",
			lifecycle: { kind: "input", dispatchRefs: [] },
			now: seededAt + 1,
		});
		const laterTwo = runtime.messages.append({
			id: "msg:f045:later-two",
			threadId: thread.id,
			from: { kind: "user", userId: ownerId },
			content: "LATER_BROADCAST_TWO",
			lifecycle: { kind: "input", dispatchRefs: [] },
			now: seededAt + 2,
		});
		runtime.readState.ack(thread.id, "b1", laterTwo.seq, seededAt + 3);
		expect(source.seq).toBeLessThan(laterOne.seq);
		expect(laterTwo.seq).toBeGreaterThan(source.seq);

		const enqueued = runtime.queue.enqueue({
			threadId: thread.id,
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
		daemon!.a2aControlPlane!.requestDrain();

		const invocationId = `inv:${thread.id}:${source.id}`;
		const attempt = await waitFor(() => {
			const latest = runtime.attempts.getLatest(invocationId, "b1");
			return latest?.deliveryState === "handled" ? latest : null;
		}, 30_000);

		// The trigger is part of this turn even though the cursor passed it;
		// the ack boundary stays at the already-consumed tail (monotonic).
		expect(attempt.deliveryBoundarySeq).toBe(laterTwo.seq);
		expect(runtime.readState.get(thread.id, "b1")?.deliveryCursor).toBe(laterTwo.seq);
		const assembled = routeContextLogs(daemon!);
		expect(assembled).toHaveLength(1);
		expect(assembled[0]!.fields).toMatchObject({
			agent_id: "b1",
			mode: "incremental",
			boundary_seq: laterTwo.seq,
			row_count: 1,
			source_record_id: source.id,
		});

		const prompts = provider.requests.filter((request) => request.model === "b-model");
		expect(prompts.length).toBe(1);
		const body = JSON.stringify(prompts[0]!.body);
		expect(body).toContain("PING_SOURCE_BELOW_CURSOR");
		expect(body).not.toContain("LATER_BROADCAST_ONE");
		expect(body).not.toContain("LATER_BROADCAST_TWO");
	}, 60_000);
});
