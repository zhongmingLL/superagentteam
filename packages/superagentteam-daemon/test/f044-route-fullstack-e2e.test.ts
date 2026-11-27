import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccountConfig, AgentCatalog, AgentConfig } from "@superagentteam/shared/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createConsoleToken } from "../src/api/console-link.ts";
import { initOperatorCredential } from "../src/auth/operator.ts";
import { type DaemonHandle, startDaemon } from "../src/index.ts";
import {
	errorResponse,
	lastMessageHasToolResult,
	startMockAnthropic,
	textResponse,
	toolCallResponse,
} from "./helpers/mock-anthropic.ts";

const HUB_ORIGIN = "http://localhost:3000";
const PI_CLI_PATH = join(import.meta.dirname, "..", "..", "coding-agent", "dist", "cli.js");

function agentConfig(id: string, model: string): AgentConfig {
	return {
		id,
		mentionPatterns: [`@${id}`],
		displayName: `Agent ${id}`,
		contextWindow: 16_384,
		roleId: "worker",
		roleDescription: "F044 route E2E v2",
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
						{ id: "c-model", name: "c-model", contextWindow: 16_384, maxTokens: 1_024 },
					],
				},
			},
		}),
	);
}

function routeLogEvents(handle: DaemonHandle): string[] {
	const entries = handle.observability.logs?.tail({ limit: 1_000 }).entries ?? [];
	return entries.map((entry) => entry.event);
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
	throw new Error("timed out waiting for F044 route E2E state");
}

describe("F044 route ownership full-stack E2E v2", () => {
	let root: string;
	let dataDir: string;
	let installationRoot: string;
	let projectDir: string;
	let daemon: DaemonHandle | null;
	let provider: Awaited<ReturnType<typeof startMockAnthropic>> | null;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "f044-route-e2e-"));
		dataDir = join(root, "data");
		installationRoot = join(root, "install");
		projectDir = join(root, "project");
		mkdirSync(installationRoot);
		mkdirSync(projectDir);
		initOperatorCredential({ dataDir });
		const catalog: AgentCatalog = {
			version: 1,
			agents: [agentConfig("a1", "a-model"), agentConfig("b1", "b-model"), agentConfig("c1", "c-model")],
		};
		const account: AccountConfig = {
			ref: "main",
			provider: "mock",
			apiKeyRef: "KEY",
			models: ["a-model", "b-model", "c-model"],
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
			runningRevision: "f044-route-e2e-v2",
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
		const thread = await createThread(base, headers, projectDir, "F044 route E2E");
		return { base, headers, thread };
	}

	async function createThread(
		base: string,
		headers: Record<string, string>,
		path: string,
		title: string,
	): Promise<{ id: string }> {
		const response = await fetch(`${base}/api/threads`, {
			method: "POST",
			headers,
			body: JSON.stringify({ projectPath: path, title, idempotencyKey: `thread-${title}` }),
		});
		expect(response.status).toBe(201);
		return (await response.json()) as { id: string };
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

	async function listMessages(
		base: string,
		headers: Record<string, string>,
		threadId: string,
	): Promise<
		Array<{
			id: string;
			type: string;
			content: string;
			from: { kind: string; agentId?: string };
			lifecycle?: { kind: string; status?: string; dispatchRefs?: Array<{ target: { kind: string; id: string } }> };
		}>
	> {
		const response = await fetch(`${base}/api/messages?threadId=${encodeURIComponent(threadId)}&limit=100`, {
			headers: { cookie: headers.cookie! },
		});
		return ((await response.json()) as { messages: Array<never> }).messages;
	}

	it("parallel barrier holds under skew; fast sibling settles while slow sibling is still running", async () => {
		provider = await startMockAnthropic(async (request) => {
			if (request.model === "a-model") {
				await sleep(900);
				return textResponse("A_SLOW_REPLY");
			}
			if (request.model === "b-model") return textResponse("B_FAST_REPLY");
			return errorResponse("unexpected model", 400);
		});
		const { base, headers, thread } = await startStack();
		const submitted = await submit(base, headers, thread.id, "parallel skew @a1 @b1", "skew");
		const invocationId = `inv:${thread.id}:${submitted.userMessageId}`;
		const runtime = daemon!.a2aControlPlane!.runtime;

		await waitFor(async () => {
			const messages = await listMessages(base, headers, thread.id);
			return messages.some((message) => message.content === "B_FAST_REPLY") ? true : null;
		}, 20_000);

		const aAttempt = runtime.attempts.getLatest(invocationId, "a1")!;
		const bAttempt = runtime.attempts.getLatest(invocationId, "b1")!;
		expect(bAttempt.deliveryState).toBe("handled");
		expect(bAttempt.settlement).toBe("settled");
		expect(runtime.turns.get(bAttempt.turnExecutionId!)?.status).toBe("completed");
		expect(runtime.messages.get(bAttempt.responseMessageId!)?.lifecycle).toMatchObject({
			kind: "response",
			status: "completed",
		});
		expect(runtime.drafts.getByTurn(bAttempt.turnExecutionId!)).toBeNull();

		// Per-target isolation: the slow sibling is still in its provider turn.
		expect(aAttempt.deliveryState).toBe("appended");
		expect(runtime.turns.get(aAttempt.turnExecutionId!)?.status).toBe("running");
		expect(runtime.messages.get(aAttempt.responseMessageId!)?.lifecycle).toMatchObject({
			kind: "response",
			status: "processing",
		});

		await waitFor(async () => {
			const messages = await listMessages(base, headers, thread.id);
			return messages.some((message) => message.content === "A_SLOW_REPLY") ? true : null;
		}, 20_000);
		await waitFor(() => (runtime.records.get(invocationId)?.status === "completed" ? true : null), 10_000);
		expect(runtime.queue.listQueued(thread.id)).toHaveLength(0);

		// Route-era structured logs are the mechanical differentiator from the
		// old folded implementation: these events did not exist before F044.
		const events = routeLogEvents(daemon!);
		for (const event of ["phase_b_appended", "turn_worker_bound", "turn_terminal"]) {
			expect(events.filter((name) => name === event).length).toBeGreaterThanOrEqual(2);
		}

		// The barrier is about prompt assembly, not provider start order.
		const bPrompts = provider.requests.filter((request) => request.model === "b-model");
		expect(bPrompts.length).toBeGreaterThan(0);
		expect(bPrompts.every((request) => !JSON.stringify(request.body).includes("A_SLOW_REPLY"))).toBe(true);
	}, 60_000);

	it("provider failure after prompt acceptance settles T1; manual retry runs attempt 2", async () => {
		let aCalls = 0;
		provider = await startMockAnthropic((request) => {
			if (request.model === "a-model") {
				aCalls += 1;
				if (aCalls === 1) return errorResponse("transient provider", 500);
				return textResponse("A_RETRY_OK");
			}
			return errorResponse("unexpected model", 400);
		});
		const { base, headers, thread } = await startStack();
		const submitted = await submit(base, headers, thread.id, "retry please @a1", "retry");
		const invocationId = `inv:${thread.id}:${submitted.userMessageId}`;
		const runtime = daemon!.a2aControlPlane!.runtime;

		const first = await waitFor(() => {
			const attempt = runtime.attempts.getLatest(invocationId, "a1");
			return attempt?.deliveryState === "failed" ? attempt : null;
		}, 15_000);
		expect(first.attempt).toBe(1);
		// The pi worker accepted the prompt before the provider 500: this is a
		// delivered failure (T1 failed + acked), not a pre-accept retryable one.
		expect(first.terminalReason).toContain("provider_error");
		expect(first.settlement).toBe("settled");
		expect(runtime.queue.listQueued(thread.id)).toHaveLength(0);

		const failedParent = await waitFor(
			() => (runtime.records.get(invocationId)?.status === "failed" ? true : null),
			10_000,
		);
		expect(failedParent).toBe(true);

		// Real user path: the failed bubble offers retry; retry admits attempt 2.
		const retry = await fetch(
			`${base}/api/threads/${encodeURIComponent(thread.id)}/invocations/${encodeURIComponent(invocationId)}/retry`,
			{ method: "POST", headers },
		);
		expect(retry.status).toBe(202);

		const second = await waitFor(() => {
			const attempt = runtime.attempts.getLatest(invocationId, "a1");
			return attempt?.attempt === 2 && attempt.deliveryState === "handled" ? attempt : null;
		}, 30_000);
		expect(runtime.messages.get(second.responseMessageId!)?.content).toBe("A_RETRY_OK");
		await waitFor(() => (runtime.records.get(invocationId)?.status === "completed" ? true : null), 10_000);
		expect(runtime.records.get(invocationId)?.status).toBe("completed");
		expect(runtime.queue.listQueued(thread.id)).toHaveLength(0);
		const failures = runtime.messages
			.getByThread(thread.id, 50)
			.filter((message) => message.lifecycle?.kind === "delivery_failure");
		expect(failures).toEqual([]);
	}, 60_000);

	it("operator cancel during a running provider turn terminalizes the chain and retires the worker", async () => {
		provider = await startMockAnthropic(async (request) => {
			if (request.model === "a-model") {
				await sleep(5_000);
				return textResponse("SHOULD_NOT_APPEAR");
			}
			return errorResponse("unexpected model", 400);
		});
		const { base, headers, thread } = await startStack();
		const submitted = await submit(base, headers, thread.id, "wait for cancel @a1", "cancel");
		const invocationId = `inv:${thread.id}:${submitted.userMessageId}`;
		const runtime = daemon!.a2aControlPlane!.runtime;

		const running = await waitFor(() => {
			const attempt = runtime.attempts.getLatest(invocationId, "a1");
			const turn = attempt?.turnExecutionId ? runtime.turns.get(attempt.turnExecutionId) : null;
			return attempt?.deliveryState === "appended" && turn?.status === "running" ? attempt : null;
		}, 15_000);

		const cancel = await fetch(`${base}/api/threads/${encodeURIComponent(thread.id)}/agents/a1/cancel`, {
			method: "POST",
			headers,
		});
		expect(cancel.status).toBe(202);

		const canceled = await waitFor(() => {
			const attempt = runtime.attempts.getLatest(invocationId, "a1");
			return attempt?.deliveryState === "canceled" ? attempt : null;
		}, 15_000);
		expect(canceled.terminalReason).toBe("operator_canceled");
		expect(runtime.turns.get(running.turnExecutionId!)?.status).toBe("canceled");
		expect(runtime.messages.get(running.responseMessageId!)?.lifecycle).toMatchObject({
			kind: "response",
			status: "canceled",
		});
		expect(runtime.records.get(invocationId)?.status).toBe("canceled");
		expect(runtime.queue.listQueued(thread.id)).toHaveLength(0);
		const worker = runtime.workerStore.listSnapshot().find((entry) => entry.id === canceled.workerId);
		expect(worker?.state).toBe("retired");
	}, 60_000);

	it("cross_post_message creates a new thread entry and settles both threads", async () => {
		let targetThreadId = "";
		provider = await startMockAnthropic((request) => {
			if (request.model === "a-model") {
				if (lastMessageHasToolResult(request.body)) return textResponse("A_CROSS_DONE");
				return toolCallResponse("superagentteam_cross_post_message", {
					threadId: targetThreadId,
					targets: [{ kind: "agent", id: "b1" }],
					bodyMd: "CROSS_FROM_T1",
				});
			}
			if (request.model === "b-model") return textResponse("B_CROSS_REPLY");
			return errorResponse("unexpected model", 400);
		});
		const { base, headers, thread } = await startStack();
		const thread2 = await createThread(base, headers, projectDir, "F044 cross target");
		targetThreadId = thread2.id;

		const submitted = await submit(base, headers, thread.id, "cross post @a1", "cross");
		const sourceInvocationId = `inv:${thread.id}:${submitted.userMessageId}`;
		const runtime = daemon!.a2aControlPlane!.runtime;

		await waitFor(async () => {
			const source = await listMessages(base, headers, thread.id);
			const target = await listMessages(base, headers, thread2.id);
			return source.some((message) => message.content === "A_CROSS_DONE") &&
				target.some((message) => message.content === "B_CROSS_REPLY")
				? true
				: null;
		}, 40_000);

		const targetMessages = await listMessages(base, headers, thread2.id);
		const input = targetMessages.find((message) => message.content === "CROSS_FROM_T1");
		expect(input?.from).toMatchObject({ kind: "agent", agentId: "a1" });
		expect(input?.lifecycle?.kind).toBe("input");
		expect(input?.lifecycle?.dispatchRefs?.some((ref) => ref.target.id === "b1")).toBe(true);
		const targetInvocationId = `inv:${thread2.id}:${input!.id}`;
		await waitFor(
			() =>
				runtime.records.get(sourceInvocationId)?.status === "completed" &&
				runtime.records.get(targetInvocationId)?.status === "completed"
					? true
					: null,
			10_000,
		);
		expect(runtime.records.get(sourceInvocationId)?.status).toBe("completed");
		expect(runtime.records.get(targetInvocationId)?.status).toBe("completed");
		const events = routeLogEvents(daemon!);
		for (const event of ["phase_b_appended", "turn_worker_bound", "turn_terminal"]) {
			expect(events.filter((name) => name === event).length).toBeGreaterThanOrEqual(2);
		}
	}, 60_000);
});
