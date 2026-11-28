import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccountConfig, AgentCatalog, AgentConfig } from "@superagentteam/shared/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createConsoleToken } from "../src/api/console-link.ts";
import { initOperatorCredential } from "../src/domains/access/operator.ts";
import { type DaemonHandle, startDaemon } from "../src/index.ts";
import { startMockAnthropic, textResponse } from "./helpers/mock-anthropic.ts";

const HUB_ORIGIN = "http://localhost:3000";
const PI_CLI_PATH = join(import.meta.dirname, "..", "..", "coding-agent", "dist", "cli.js");

function agentConfig(id: string, model: string): AgentConfig {
	return {
		id,
		mentionPatterns: [`@${id}`],
		displayName: `Agent ${id}`,
		contextWindow: 16_384,
		roleId: "worker",
		roleDescription: "F053 queue steer E2E",
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
					models: [{ id: "a-model", name: "a-model", contextWindow: 16_384, maxTokens: 1_024 }],
				},
			},
		}),
	);
}

function contains(body: Record<string, unknown>, text: string): boolean {
	return JSON.stringify(body).includes(text);
}

async function waitFor<T>(check: () => Promise<T | null>, timeoutMs = 45_000): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = await check();
		if (value !== null) return value;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error("timed out waiting for F053 steer state");
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("F053 queue steer full-stack E2E", () => {
	let root: string;
	let dataDir: string;
	let installationRoot: string;
	let projectDir: string;
	let daemon: DaemonHandle | null;
	let provider: Awaited<ReturnType<typeof startMockAnthropic>> | null;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "f053-steer-e2e-"));
		dataDir = join(root, "data");
		installationRoot = join(root, "install");
		projectDir = join(root, "project");
		mkdirSync(installationRoot);
		mkdirSync(projectDir);
		initOperatorCredential({ dataDir });
		const catalog: AgentCatalog = { version: 1, agents: [agentConfig("a1", "a-model")] };
		const account: AccountConfig = {
			ref: "main",
			provider: "mock",
			apiKeyRef: "KEY",
			models: ["a-model"],
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
		threadId: string;
	}> {
		if (!provider) throw new Error("mock provider not started");
		writeWorkerModels(join(dataDir, "worker-agent"), provider.baseUrl);
		daemon = await startDaemon({
			installationRoot,
			dataDir,
			runningRevision: "f053-steer-e2e",
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
		const threadResponse = await fetch(`${base}/api/threads`, {
			method: "POST",
			headers,
			body: JSON.stringify({ projectPath: projectDir, title: "F053 steer", idempotencyKey: "f053-thread" }),
		});
		expect(threadResponse.status).toBe(201);
		const thread = (await threadResponse.json()) as { id: string };
		return { base, headers, threadId: thread.id };
	}

	async function post(
		base: string,
		headers: Record<string, string>,
		threadId: string,
		content: string,
		idempotencyKey: string,
	): Promise<{ entryId: string; userMessageId: string }> {
		const response = await fetch(`${base}/api/messages`, {
			method: "POST",
			headers,
			body: JSON.stringify({ threadId, content, idempotencyKey, targets: ["a1"] }),
		});
		expect(response.status).toBe(202);
		return (await response.json()) as { entryId: string; userMessageId: string };
	}

	async function steer(
		base: string,
		headers: Record<string, string>,
		threadId: string,
		entryId: string,
		mode: "guide" | "interrupt",
	): Promise<Response> {
		return fetch(`${base}/api/threads/${encodeURIComponent(threadId)}/queue/${encodeURIComponent(entryId)}/steer`, {
			method: "POST",
			headers,
			body: JSON.stringify({ targetAgentId: "a1", mode }),
		});
	}

	async function steerWithRetry(
		base: string,
		headers: Record<string, string>,
		threadId: string,
		entryId: string,
		mode: "guide" | "interrupt",
	): Promise<Response> {
		const deadline = Date.now() + 5_000;
		let response = await steer(base, headers, threadId, entryId, mode);
		while (Date.now() < deadline && (response.status === 409 || response.status === 404)) {
			const body = (await response
				.clone()
				.json()
				.catch(() => ({}))) as { error?: string };
			if (body.error !== "entry_processing" && body.error !== "target_not_pending") break;
			await delay(100);
			response = await steer(base, headers, threadId, entryId, mode);
		}
		return response;
	}

	async function messages(
		base: string,
		headers: Record<string, string>,
		threadId: string,
	): Promise<
		Array<{
			id: string;
			type: string;
			content: string;
			lifecycle?: { kind: string; dispatchRefs?: Array<{ target: { id: string }; turnExecutionId?: string }> };
		}>
	> {
		const response = await fetch(`${base}/api/messages?threadId=${encodeURIComponent(threadId)}&limit=50`, {
			headers: { cookie: headers.cookie! },
		});
		return ((await response.json()) as { messages: never[] }).messages;
	}

	it("guides a queued message into the live turn and the provider sees it", async () => {
		provider = await startMockAnthropic(async (request) => {
			if (request.model !== "a-model") return textResponse("UNEXPECTED_MODEL");
			if (contains(request.body, "GUIDE_ME")) return textResponse("GUIDED_DONE");
			await delay(1_200);
			return textResponse("FIRST_DONE");
		});
		const { base, headers, threadId } = await startStack();

		await post(base, headers, threadId, "start the slow turn", "f053-guide-1");
		await waitFor(async () => (provider!.requests.length >= 1 ? true : null));
		const queued = await post(base, headers, threadId, "GUIDE_ME now", "f053-guide-2");
		const steered = await steerWithRetry(base, headers, threadId, queued.entryId, "guide");
		expect(steered.status).toBe(202);
		expect(await steered.json()).toMatchObject({ status: "guided", mode: "guide", targetAgentId: "a1" });

		const finalMessages = await waitFor(async () => {
			const list = await messages(base, headers, threadId);
			return list.some((message) => message.type === "assistant" && message.content.includes("GUIDED_DONE"))
				? list
				: null;
		});
		expect(finalMessages.some((message) => message.content.includes("GUIDED_DONE"))).toBe(true);
		expect(provider.requests.some((request) => contains(request.body, "GUIDE_ME"))).toBe(true);
		const input = finalMessages.find((message) => message.type === "user" && message.content === "GUIDE_ME now");
		expect(input?.lifecycle?.kind).toBe("input");
		if (input?.lifecycle?.kind === "input") {
			expect(input.lifecycle.dispatchRefs?.some((ref) => ref.target.id === "a1")).toBe(true);
		}
	});

	it("interrupts a slow turn and starts the queued message immediately", async () => {
		provider = await startMockAnthropic(async (request) => {
			if (request.model !== "a-model") return textResponse("UNEXPECTED_MODEL");
			if (contains(request.body, "INTERRUPT_ME")) return textResponse("INTERRUPTED_DONE");
			await delay(5_000);
			return textResponse("SHOULD_NOT_APPEAR");
		});
		const { base, headers, threadId } = await startStack();

		await post(base, headers, threadId, "start the very slow turn", "f053-interrupt-1");
		await waitFor(async () => (provider!.requests.length >= 1 ? true : null));
		const queued = await post(base, headers, threadId, "INTERRUPT_ME now", "f053-interrupt-2");
		const steered = await steerWithRetry(base, headers, threadId, queued.entryId, "interrupt");
		expect([202]).toContain(steered.status);
		expect(await steered.json()).toMatchObject({ mode: "interrupt", targetAgentId: "a1" });

		const finalMessages = await waitFor(async () => {
			const list = await messages(base, headers, threadId);
			return list.some((message) => message.type === "assistant" && message.content.includes("INTERRUPTED_DONE"))
				? list
				: null;
		});
		expect(finalMessages.some((message) => message.content.includes("SHOULD_NOT_APPEAR"))).toBe(false);
		expect(provider.requests.some((request) => contains(request.body, "INTERRUPT_ME"))).toBe(true);
	});
});
