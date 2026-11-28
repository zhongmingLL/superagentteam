import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccountConfig, AgentCatalog, AgentConfig } from "@superagentteam/shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createConsoleToken } from "../src/api/console-link.ts";
import type { A2ARuntime } from "../src/app/a2a-runtime.ts";
import { initOperatorCredential } from "../src/domains/access/operator.ts";
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

	it("F048: a long turn does not block an independent agent's entry", async () => {
		provider = await startMockAnthropic(async (request) => {
			if (request.model === "a-model") {
				await sleep(3_000);
				return textResponse("A_LONG_DONE");
			}
			if (request.model === "b-model") return textResponse("B_INDEPENDENT_DONE");
			return errorResponse("unexpected model", 400);
		});
		const { base, headers, thread } = await startStack();
		const runtime = daemon!.a2aControlPlane!.runtime;

		const longEntry = await submit(base, headers, thread.id, "long @a1", "f048-long");
		const longInvocation = `inv:${thread.id}:${longEntry.userMessageId}`;
		const running = await waitFor(() => {
			const attempt = runtime.attempts.getLatest(longInvocation, "a1");
			return attempt?.deliveryState === "appended" ? attempt : null;
		}, 15_000);

		const quickEntry = await submit(base, headers, thread.id, "quick @b1", "f048-quick");
		const quickInvocation = `inv:${thread.id}:${quickEntry.userMessageId}`;
		const quick = await waitFor(() => {
			const attempt = runtime.attempts.getLatest(quickInvocation, "b1");
			return attempt?.deliveryState === "handled" ? attempt : null;
		}, 15_000);

		// B settled while A's turn was still running.
		expect(runtime.messages.get(quick.responseMessageId!)?.content).toBe("B_INDEPENDENT_DONE");
		expect(runtime.turns.get(running.turnExecutionId!)?.status).toBe("running");
		const queueView = (await fetch(`${base}/api/threads/${encodeURIComponent(thread.id)}/queue`, {
			headers: { cookie: headers.cookie! },
		}).then((response) => response.json())) as {
			queue: Array<{ status: string; targetAgentIds: string[] }>;
			activeInvocations: Array<{ agentId: string; childStatus: string }>;
		};
		expect(queueView.queue.some((entry) => entry.targetAgentIds.includes("b1"))).toBe(false);
		expect(queueView.activeInvocations.some((slot) => slot.agentId === "a1" && slot.childStatus === "running")).toBe(
			true,
		);

		await waitFor(
			() => (runtime.attempts.getLatest(longInvocation, "a1")?.deliveryState === "handled" ? true : null),
			15_000,
		);
		expect(runtime.queue.listQueued(thread.id)).toHaveLength(0);
	}, 60_000);

	it("F048: a second entry for the same agent waits for the first turn to finish", async () => {
		let aCalls = 0;
		provider = await startMockAnthropic(async (request) => {
			if (request.model === "a-model") {
				aCalls += 1;
				if (aCalls === 1) await sleep(1_500);
				return textResponse(`A_CALL_${aCalls}`);
			}
			return errorResponse("unexpected model", 400);
		});
		const { base, headers, thread } = await startStack();
		const runtime = daemon!.a2aControlPlane!.runtime;

		const first = await submit(base, headers, thread.id, "first @a1", "f048-order-1");
		const firstInvocation = `inv:${thread.id}:${first.userMessageId}`;
		const firstRunning = await waitFor(() => {
			const attempt = runtime.attempts.getLatest(firstInvocation, "a1");
			return attempt?.deliveryState === "appended" ? attempt : null;
		}, 15_000);
		expect(runtime.turns.get(firstRunning.turnExecutionId!)?.status).toBe("running");

		const second = await submit(base, headers, thread.id, "second @a1", "f048-order-2");
		const secondInvocation = `inv:${thread.id}:${second.userMessageId}`;
		await sleep(300);
		expect(runtime.attempts.getLatest(secondInvocation, "a1")).toBeNull();
		expect(
			runtime.queue.listQueued(thread.id).some((entry) => entry.targets.some((target) => target.id === "a1")),
		).toBe(true);

		await waitFor(() => {
			const attempt = runtime.attempts.getLatest(secondInvocation, "a1");
			return attempt?.deliveryState === "handled" ? attempt : null;
		}, 20_000);
		expect(aCalls).toBe(2);
		expect(runtime.queue.listQueued(thread.id)).toHaveLength(0);
	}, 60_000);

	it("F048: tracker preemption aborts the old turn and leaves no zombie (B5)", async () => {
		provider = await startMockAnthropic(async (request) => {
			if (request.model === "a-model") {
				await sleep(5_000);
				return textResponse("SHOULD_NOT_APPEAR");
			}
			return errorResponse("unexpected model", 400);
		});
		const { base, headers, thread } = await startStack();
		const runtime = daemon!.a2aControlPlane!.runtime;

		const submitted = await submit(base, headers, thread.id, "preempt me @a1", "f048-preempt");
		const invocationId = `inv:${thread.id}:${submitted.userMessageId}`;
		const running = await waitFor(() => {
			const attempt = runtime.attempts.getLatest(invocationId, "a1");
			return attempt?.deliveryState === "appended" ? attempt : null;
		}, 15_000);
		const ownerId = runtime.threads.get(thread.id)!.createdBy;

		// Simulate the tracker preemption path; the old runner must still
		// terminalize its own turn/R instead of leaving a zombie.
		runtime.tracker.start(thread.id, "a1", ownerId, "te:f048-preempt");
		const canceled = await waitFor(() => {
			const attempt = runtime.attempts.getLatest(invocationId, "a1");
			return attempt?.deliveryState === "canceled" ? attempt : null;
		}, 15_000);
		expect(runtime.turns.get(running.turnExecutionId!)?.status).toBe("canceled");
		expect(runtime.messages.get(canceled.responseMessageId!)?.lifecycle).toMatchObject({
			kind: "response",
			status: "canceled",
		});
		expect(runtime.tracker.getExecutionId(thread.id, "a1")).toBe("te:f048-preempt");
		expect(runtime.tracker.complete(thread.id, "a1", "te:f048-preempt")).toBe(true);
		expect(runtime.tracker.isBusy(thread.id, "a1")).toBe(false);
	}, 60_000);

	it("F046: multi_mention fans out, aggregates once, and delivers one callback", async () => {
		provider = await startMockAnthropic((request) => {
			const body = JSON.stringify(request.body);
			if (request.model === "a-model") {
				if (lastMessageHasToolResult(request.body)) return textResponse("A_MM_TOOL_ACK");
				if (body.includes("MM_CALLBACK_MARKER")) return textResponse("A_MM_FINAL");
				return toolCallResponse("superagentteam_multi_mention", {
					targets: [
						{ kind: "agent", id: "b1" },
						{ kind: "agent", id: "c1" },
					],
					question: "MM_CALLBACK_MARKER: 2+2 等于几？",
					callbackTo: "a1",
					triggerType: "info-gap",
				});
			}
			if (request.model === "b-model") {
				if (lastMessageHasToolResult(request.body)) return textResponse("B_MM_REPLY");
				if (body.includes("MM_CALLBACK_MARKER")) {
					return toolCallResponse("superagentteam_post_message", {
						targets: [{ kind: "agent", id: "a1" }],
						bodyMd: "B_DUPLICATE_ANSWER",
					});
				}
				return textResponse("B_MM_REPLY");
			}
			if (request.model === "c-model") return textResponse("C_MM_REPLY");
			return errorResponse("unexpected model", 400);
		});
		const { base, headers, thread } = await startStack();
		const runtime = daemon!.a2aControlPlane!.runtime;

		const submitted = await submit(base, headers, thread.id, "please fan out @a1", "f046-mm");
		await waitFor(async () => {
			const messages = await listMessages(base, headers, thread.id);
			return messages.some((message) => message.content === "A_MM_FINAL") &&
				messages.some((message) => message.content === "B_MM_REPLY") &&
				messages.some((message) => message.content === "C_MM_REPLY")
				? true
				: null;
		}, 40_000);

		const all = runtime.messages.getByThread(thread.id, 100);
		const source = all.find((message) => message.content.startsWith("[Multi-Mention from"));
		expect(source).toBeTruthy();
		const request = runtime.multiMention.getBySourceRecordId(source!.id)!;
		// Messages become visible at T2, but the callback record is finalized by
		// the QueueProcessor after dispatch; wait for the terminal state asserted
		// below instead of racing it (observed CI flake: running vs completed).
		await waitFor(() => {
			const callback = runtime.multiMention.statusView(request.requestId)?.callback;
			return callback?.status === "completed" ? callback : null;
		}, 15_000);
		const settled = runtime.multiMention.getBySourceRecordId(source!.id)!;
		expect(settled.status).toBe("done");
		expect(settled.targetAgentIds.sort()).toEqual(["b1", "c1"]);
		expect(settled.callbackToAgentId).toBe("a1");

		const view = runtime.multiMention.statusView(request.requestId)!;
		expect(view.request.status).toBe("done");
		expect(view.responses).toHaveLength(2);
		expect(view.responses.every((response) => response.status === "received")).toBe(true);
		expect(view.allFailed).toBe(false);
		expect(view.callback?.status).toBe("completed");
		expect(view.callback?.callbackToAgentId).toBe("a1");
		if (process.env.SUPERAGENTTEAM_E2E_TRACE === "1") {
			console.info(`[f046-mm] callback=${JSON.stringify(view.callback)}`);
		}

		const aggregate = runtime.messages.get(request.aggregateMessageId!)!;
		expect(aggregate.from).toEqual({ kind: "system", service: "multi_mention" });
		expect(aggregate.extra?.multiMention).toMatchObject({
			requestId: request.requestId,
			status: "done",
			callbackTo: "a1",
			allFailed: false,
		});
		const aggregates = all.filter(
			(message) =>
				message.from.kind === "system" ||
				(message.extra?.multiMention as { requestId?: string } | undefined)?.requestId === request.requestId,
		);
		expect(aggregates.filter((message) => message.id === aggregate.id)).toHaveLength(1);

		// The target's duplicate post_message is rejected before any message/queue
		// or parent exists; only the orchestrator's aggregate reaches a1.
		expect(all.some((message) => message.content.includes("B_DUPLICATE_ANSWER"))).toBe(false);
		expect(runtime.records.get(`inv:${thread.id}:${aggregate.id}`)?.status).toBe("completed");
		expect(runtime.records.get(`inv:${thread.id}:${submitted.userMessageId}`)?.status).toBe("completed");
		expect(runtime.queue.listQueued(thread.id)).toHaveLength(0);
	}, 60_000);

	it("F046b: a post_message successor is admitted only after the caller's T2 commit", async () => {
		let runtimeForCheck: A2ARuntime | null = null;
		let aInvocationForCheck = "";
		let aCompletedWhenBRequested: boolean | null = null;
		provider = await startMockAnthropic(async (request) => {
			if (request.model === "a-model") {
				if (lastMessageHasToolResult(request.body)) {
					await sleep(1_500);
					return textResponse("A_DEFERRED_DONE");
				}
				return toolCallResponse("superagentteam_post_message", {
					targets: [{ kind: "agent", id: "b1" }],
					bodyMd: "DEFERRED_SUCCESSOR_BODY",
				});
			}
			if (request.model === "b-model") {
				const aAttempt = runtimeForCheck?.attempts.getLatest(aInvocationForCheck, "a1");
				const aResponse = aAttempt?.responseMessageId
					? runtimeForCheck?.messages.get(aAttempt.responseMessageId)
					: null;
				aCompletedWhenBRequested =
					aResponse?.lifecycle?.kind === "response" && aResponse.lifecycle.status === "completed";
				return textResponse("B_DEFERRED_DONE");
			}
			return errorResponse("unexpected model", 400);
		});
		const { base, headers, thread } = await startStack();
		const runtime = daemon!.a2aControlPlane!.runtime;
		runtimeForCheck = runtime;
		const submitted = await submit(base, headers, thread.id, "deferred @a1", "f046b-deferred");
		const aInvocation = `inv:${thread.id}:${submitted.userMessageId}`;
		aInvocationForCheck = aInvocation;

		const successorMessage = await waitFor(() => {
			const message = runtime.messages
				.getByThread(thread.id, 50)
				.find((candidate) => candidate.content === "DEFERRED_SUCCESSOR_BODY");
			return message ?? null;
		}, 15_000);
		// The tool message is durable, but no successor queue entry exists until
		// the caller's R reaches terminal state in T2.
		expect(
			[...runtime.queue.listQueued(thread.id), ...runtime.queue.listActive(thread.id)].some(
				(entry) => entry.payload.sourceRecordId === successorMessage.id,
			),
		).toBe(false);

		const aAttempt = runtime.attempts.getLatest(aInvocation, "a1")!;
		const aResponseId = aAttempt.responseMessageId!;
		await waitFor(() => {
			const bMessages = runtime.messages
				.getByThread(thread.id, 50)
				.filter((candidate) => candidate.content === "B_DEFERRED_DONE");
			return bMessages.length === 0 ? null : true;
		}, 20_000);
		expect(aCompletedWhenBRequested).toBe(true);
		expect(runtime.records.get(aInvocation)?.status).toBe("completed");
		expect(runtime.messages.get(aResponseId)?.lifecycle).toMatchObject({
			kind: "response",
			status: "completed",
		});
		const claims = runtime.credentials.listToolCallClaims(aAttempt.turnExecutionId!);
		expect(claims).toHaveLength(1);
		expect(claims[0]!.claim.queueEntryId).toBeTruthy();
		expect(claims[0]!.claim.pendingSuccessor).toBeUndefined();
	}, 60_000);

	async function assertPhaseBFault(
		label: string,
		reason: "draft_create_failed" | "credential_mint_failed" | "retire_targets_failed",
		detail: string,
		inject: (runtime: A2ARuntime) => void,
	): Promise<void> {
		provider = await startMockAnthropic((request) => {
			if (request.model === "a-model") return textResponse("SHOULD_NOT_REACH_PROVIDER");
			return errorResponse("unexpected model", 400);
		});
		const { base, headers, thread } = await startStack();
		const runtime = daemon!.a2aControlPlane!.runtime;
		inject(runtime);

		const submitted = await submit(base, headers, thread.id, `phase b fault ${label} @a1`, `fault-${label}`);
		const invocationId = `inv:${thread.id}:${submitted.userMessageId}`;
		const failed = await waitFor(() => {
			const attempt = runtime.attempts.getLatest(invocationId, "a1");
			return attempt?.deliveryState === "failed" ? attempt : null;
		}, 15_000);

		// Phase B rolled back: typed prestart failure, no TurnExecution/R chain,
		// target still pending for the bounded retry, and no provider work.
		expect(failed.terminalReason).toBe("phase_b_failed");
		expect(failed.turnExecutionId).toBeNull();
		expect(runtime.turns.listByInvocation(invocationId)).toHaveLength(0);
		expect(runtime.records.get(invocationId)?.status).toBe("running");
		const failures = runtime.messages
			.getByThread(thread.id, 50)
			.filter((message) => message.lifecycle?.kind === "delivery_failure");
		expect(failures).toHaveLength(1);
		expect(failures[0]!.lifecycle).toMatchObject({ kind: "delivery_failure", reason });
		expect(failures[0]!.content).toContain(detail);
		const queued = runtime.queue.listQueued(thread.id);
		expect(queued).toHaveLength(1);
		expect(queued[0]!.targets.map((target) => target.id)).toEqual(["a1"]);
		expect(provider.requests).toHaveLength(0);
	}

	it("R7: draft-create failure is prestart-isolated and leaves the target pending", async () => {
		await assertPhaseBFault("draft", "draft_create_failed", "draft boom", (runtime) => {
			vi.spyOn(runtime.drafts, "create").mockImplementationOnce(() => {
				throw new Error("draft boom");
			});
		});
	}, 60_000);

	it("R7: credential-mint failure is prestart-isolated and leaves the target pending", async () => {
		await assertPhaseBFault("credential", "credential_mint_failed", "credential boom", (runtime) => {
			vi.spyOn(runtime.credentials, "create").mockImplementationOnce(() => {
				throw new Error("credential boom");
			});
		});
	}, 60_000);

	it("R7: retire-targets failure is prestart-isolated and leaves the target pending", async () => {
		await assertPhaseBFault("retire", "retire_targets_failed", "retire boom", (runtime) => {
			vi.spyOn(runtime.queue, "retireTargets").mockImplementationOnce(() => {
				throw new Error("retire boom");
			});
		});
	}, 60_000);
});
