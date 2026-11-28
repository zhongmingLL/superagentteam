import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccountConfig, AgentCatalog, AgentConfig } from "@superagentteam/shared/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createConsoleToken } from "../src/api/console-link.ts";
import { initOperatorCredential } from "../src/domains/access/operator.ts";
import { type DaemonHandle, startDaemon } from "../src/index.ts";
import {
	lastMessageHasToolResult,
	startMockAnthropic,
	textResponse,
	toolCallResponse,
} from "./helpers/mock-anthropic.ts";

const HUB_ORIGIN = "http://localhost:3000";
const PI_CLI_PATH = join(import.meta.dirname, "..", "..", "coding-agent", "dist", "cli.js");

const INTERACTIVE_BLOCK = {
	id: "choose",
	kind: "interactive",
	v: 1,
	interactiveType: "select",
	title: "选一个方案",
	options: [
		{ id: "a", label: "方案 A" },
		{ id: "b", label: "方案 B" },
	],
};

function agentConfig(id: string, model: string): AgentConfig {
	return {
		id,
		mentionPatterns: [`@${id}`],
		displayName: `Agent ${id}`,
		contextWindow: 16_384,
		roleId: "worker",
		roleDescription: "F056 interactive fullstack",
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

async function waitFor<T>(check: () => Promise<T | null>, timeoutMs = 40_000): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = await check();
		if (value !== null) return value;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error("timed out waiting for F056 full-stack state");
}

describe("F056 interactive rich-block full stack", () => {
	let root: string;
	let dataDir: string;
	let installationRoot: string;
	let projectDir: string;
	let daemon: DaemonHandle | null;
	let provider: Awaited<ReturnType<typeof startMockAnthropic>> | null;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "f056-fullstack-"));
		dataDir = join(root, "data");
		installationRoot = join(root, "install");
		projectDir = join(root, "project");
		mkdirSync(installationRoot);
		mkdirSync(projectDir);
		initOperatorCredential({ dataDir });
		const catalog: AgentCatalog = { version: 1, agents: [agentConfig("a1", "a-model")] };
		const account: AccountConfig = { ref: "main", provider: "mock", apiKeyRef: "KEY", models: ["a-model"] };
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

	it("returns the operator selection to a real worker and continues the turn", async () => {
		provider = await startMockAnthropic((request) => {
			if (request.model !== "a-model") return textResponse("UNEXPECTED_MODEL");
			if (lastMessageHasToolResult(request.body)) return textResponse("PICK_ONE");
			if (JSON.stringify(request.body).includes("我选了")) return textResponse("CHOICE_RECEIVED");
			return toolCallResponse("superagentteam_create_rich_block", { block: INTERACTIVE_BLOCK });
		});
		writeWorkerModels(join(dataDir, "worker-agent"), provider.baseUrl);
		daemon = await startDaemon({
			installationRoot,
			dataDir,
			runningRevision: "f056-fullstack",
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
			body: JSON.stringify({ projectPath: projectDir, title: "F056 full-stack", idempotencyKey: "f056-thread" }),
		});
		expect(threadResponse.status).toBe(201);
		const thread = (await threadResponse.json()) as { id: string };

		const posted = await fetch(`${base}/api/messages`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				threadId: thread.id,
				content: "给我一个方案 @a1",
				idempotencyKey: "f056-start",
				targets: ["a1"],
			}),
		});
		expect(posted.status).toBe(202);

		type View = {
			id: string;
			type: string;
			content: string;
			from: { kind: string; agentId?: string };
			extra?: {
				targetAgentIds?: string[];
				rich?: { blocks: Array<Record<string, unknown>> };
			};
		};
		const pick = await waitFor(async () => {
			const response = await fetch(`${base}/api/messages?threadId=${encodeURIComponent(thread.id)}&limit=50`, {
				headers: { cookie },
			});
			const body = (await response.json()) as { messages: View[] };
			const assistant = body.messages.find(
				(message) => message.type === "assistant" && message.content === "PICK_ONE",
			);
			const block = assistant?.extra?.rich?.blocks?.find((item) => item.id === "choose");
			return assistant && block ? { assistant, block } : null;
		});
		expect(pick.block).toMatchObject({ kind: "interactive", interactiveType: "select" });

		const respond = await fetch(
			`${base}/api/messages/${encodeURIComponent(pick.assistant.id)}/rich-blocks/choose/respond`,
			{
				method: "POST",
				headers,
				body: JSON.stringify({ selectedIds: ["a"] }),
			},
		);
		expect(respond.status).toBe(202);
		const receipt = (await respond.json()) as { userMessageId: string; targetAgentIds: string[] };
		expect(receipt.targetAgentIds).toEqual(["a1"]);

		const final = await waitFor(async () => {
			const response = await fetch(`${base}/api/messages?threadId=${encodeURIComponent(thread.id)}&limit=50`, {
				headers: { cookie },
			});
			const body = (await response.json()) as { messages: View[] };
			const selection = body.messages.find((message) => message.id === receipt.userMessageId);
			const reply = body.messages.find(
				(message) => message.type === "assistant" && message.content === "CHOICE_RECEIVED",
			);
			return selection && reply ? body.messages : null;
		});
		const selection = final.find((message) => message.id === receipt.userMessageId)!;
		expect(selection.content).toBe("我选了：方案 A（选一个方案）");
		expect(selection.extra?.targetAgentIds).toEqual(["a1"]);
		const original = final.find((message) => message.id === pick.assistant.id)!;
		expect(original.extra?.rich?.blocks.find((item) => item.id === "choose")).toMatchObject({
			disabled: true,
			selectedIds: ["a"],
		});

		const again = await fetch(
			`${base}/api/messages/${encodeURIComponent(pick.assistant.id)}/rich-blocks/choose/respond`,
			{
				method: "POST",
				headers,
				body: JSON.stringify({ selectedIds: ["b"] }),
			},
		);
		expect(again.status).toBe(409);

		const trace = daemon.observability.traces.query({ threadId: thread.id, limit: 200 });
		const respondSpan = trace.spans.find((span) => span.name === "superagentteam.rich_block.respond");
		expect(respondSpan?.status.code).toBe("ok");
		expect(respondSpan?.attributes["interactive.type"]).toBe("select");
		expect(respondSpan?.attributes["block.id"]).toBeTruthy();
		expect(respondSpan?.attributes["block.id"]).not.toBe("choose");
	}, 90_000);
});
