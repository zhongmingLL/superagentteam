import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccountConfig, AgentCatalog, AgentConfig } from "@superagentteam/shared/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createConsoleToken } from "../src/api/console-link.ts";
import { initOperatorCredential } from "../src/auth/operator.ts";
import { type DaemonHandle, startDaemon } from "../src/index.ts";
import { F018Database } from "../src/infrastructure/db/database.ts";
import {
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
		roleDescription: "F037 full-stack E2E",
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

async function waitFor<T>(check: () => Promise<T | null>, timeoutMs = 30_000): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = await check();
		if (value !== null) return value;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error("timed out waiting for F037 full-stack state");
}

describe("F037 full-stack thread-first E2E", () => {
	let root: string;
	let dataDir: string;
	let installationRoot: string;
	let projectDir: string;
	let daemon: DaemonHandle | null;
	let provider: Awaited<ReturnType<typeof startMockAnthropic>> | null;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "f037-fullstack-"));
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

	it("drives a real worker through post_message to a second worker and settles both replies", async () => {
		provider = await startMockAnthropic((request) => {
			if (request.model === "a-model") {
				if (lastMessageHasToolResult(request.body)) return textResponse("A_DONE");
				return toolCallResponse("superagentteam_post_message", {
					targets: [{ kind: "agent", id: "b1" }],
					bodyMd: "POST_FROM_A",
				});
			}
			if (request.model === "b-model") return textResponse("B_DONE");
			return textResponse("UNEXPECTED_MODEL");
		});
		writeWorkerModels(join(dataDir, "worker-agent"), provider.baseUrl);
		daemon = await startDaemon({
			installationRoot,
			dataDir,
			runningRevision: "f037-fullstack-e2e",
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
			body: JSON.stringify({ projectPath: projectDir, title: "F037 full-stack", idempotencyKey: "f037-thread" }),
		});
		expect(threadResponse.status).toBe(201);
		const thread = (await threadResponse.json()) as { id: string };

		const posted = await fetch(`${base}/api/messages`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				threadId: thread.id,
				content: "kick off the A2A chain",
				idempotencyKey: "f037-message",
				targets: ["a1"],
			}),
		});
		expect(posted.status).toBe(202);

		const messages = await waitFor(async () => {
			const response = await fetch(`${base}/api/messages?threadId=${encodeURIComponent(thread.id)}&limit=50`, {
				headers: { cookie },
			});
			const body = (await response.json()) as {
				messages: Array<{
					id: string;
					type: string;
					content: string;
					from: { kind: string; agentId?: string };
					extra?: { targetAgentIds?: string[] };
					lifecycle?: {
						kind: string;
						status?: string;
						dispatchRefs?: Array<{ target: { kind: string; id: string } }>;
					};
					toolEvents?: Array<{ name: string }>;
				}>;
			};
			const assistant = body.messages.filter((message) => message.type === "assistant");
			return assistant.some((message) => message.content === "A_DONE") &&
				assistant.some((message) => message.content === "B_DONE")
				? body.messages
				: null;
		}, 40_000);

		const aReply = messages.find((message) => message.type === "assistant" && message.content === "A_DONE");
		const bReply = messages.find((message) => message.type === "assistant" && message.content === "B_DONE");
		expect(aReply?.from.agentId).toBe("a1");
		expect(bReply?.from.agentId).toBe("b1");
		expect(aReply?.toolEvents?.some((event) => event.name === "superagentteam_post_message")).toBe(true);

		const agentInput = messages.find(
			(message) =>
				message.from.kind === "agent" &&
				message.from.agentId === "a1" &&
				message.lifecycle?.kind === "input" &&
				message.content === "POST_FROM_A",
		);
		expect(agentInput?.content).toBe("POST_FROM_A");
		expect(agentInput?.lifecycle?.kind).toBe("input");
		expect(agentInput?.lifecycle?.dispatchRefs?.some((ref) => ref.target.id === "b1")).toBe(true);

		const db = new F018Database({ path: join(dataDir, "f018.db") });
		try {
			const completed = await waitFor(async () => {
				const row = db.db
					.prepare("SELECT COUNT(*) AS count FROM invocation_records WHERE status = 'completed'")
					.get() as { count: number };
				return row.count >= 2 ? row : null;
			}, 5_000);
			expect(completed.count).toBeGreaterThanOrEqual(2);
			const legacy = db.db
				.prepare(
					"SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('tasks','handoffs','custody','reviews','merges')",
				)
				.get() as { count: number };
			expect(legacy.count).toBe(0);
		} finally {
			db.close();
		}
	}, 60_000);
});
