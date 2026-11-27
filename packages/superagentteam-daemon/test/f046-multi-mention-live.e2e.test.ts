import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccountConfig, AgentCatalog, AgentConfig } from "@superagentteam/shared/types";
import { afterEach, describe, expect, it } from "vitest";

import { buildA2ARuntime } from "../src/domains/a2a/runtime.ts";
import { buildRegistry } from "../src/domains/agent/registry.ts";
import { PiWorkerSpawnPort } from "../src/domains/worker/pi-spawn.ts";
import { F018Database } from "../src/infrastructure/db/database.ts";
import {
	lastMessageHasToolResult,
	type MockAnthropicServer,
	startMockAnthropic,
	textResponse,
	toolCallResponse,
} from "./helpers/mock-anthropic.ts";

// F046 AC-E2E (0021 standard): hybrid P layer. The tool trigger is a
// deterministic mock (A), while B/C are real provider turns; aggregate and
// callback still run through the real queue/orchestrator. This avoids making
// the test depend on a real model choosing to call a tool.
// Run with:
//   set -a; source ~/.config/superagentteam/runtime.env; set +a
//   SUPERAGENTTEAM_LIVE_PROVIDER=1 \
//   SUPERAGENTTEAM_LIVE_PROVIDER_ID=kimi-coding \
//   SUPERAGENTTEAM_LIVE_API_KEY_REF=KIMI_API_KEY \
//   SUPERAGENTTEAM_LIVE_MODEL=kimi-for-coding \
//     npx vitest --run test/f046-multi-mention-live.e2e.test.ts

const liveProvider = process.env.SUPERAGENTTEAM_LIVE_PROVIDER_ID ?? "kimi-coding";
const liveApiKeyRef = process.env.SUPERAGENTTEAM_LIVE_API_KEY_REF ?? "KIMI_API_KEY";
const liveEnabled = process.env.SUPERAGENTTEAM_LIVE_PROVIDER === "1" && Boolean(process.env[liveApiKeyRef]);
const liveModel = process.env.SUPERAGENTTEAM_LIVE_MODEL ?? "kimi-for-coding";
const REAL_CLI_PATH = join(import.meta.dirname, "..", "..", "coding-agent", "dist", "cli.js");

const dirs: string[] = [];
let mock: MockAnthropicServer | null = null;

function agentConfig(id: string, accountRef: string, model: string): AgentConfig {
	return {
		id,
		mentionPatterns: [`@${id}`],
		displayName: `Agent ${id}`,
		contextWindow: 128_000,
		roleId: "worker",
		roleDescription: "F046 live multi_mention",
		restrictions: [],
		strengths: [],
		accountRef,
		defaultModel: model,
		sessionChain: true,
		enabled: true,
	};
}

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

function writeMockModels(agentDir: string, baseUrl: string): void {
	mkdirSync(agentDir, { recursive: true, mode: 0o700 });
	writeFileSync(
		join(agentDir, "models.json"),
		JSON.stringify({
			providers: {
				mock: {
					baseUrl,
					api: "anthropic-messages",
					apiKey: "test",
					models: [{ id: "mock-model", name: "mock-model", contextWindow: 16_384, maxTokens: 1_024 }],
				},
			},
		}),
	);
}

function makeWorld(): ReturnType<typeof buildA2ARuntime> {
	if (!mock) throw new Error("mock provider not started");
	const dir = mkdtempSync(join(tmpdir(), "f046-live-"));
	dirs.push(dir);
	const projectPath = join(dir, "project");
	mkdirSync(projectPath, { recursive: true });
	writeMockModels(join(dir, "agent"), mock.baseUrl);
	const db = new F018Database({ path: join(dir, "f046-live.db") });
	db.db
		.prepare(
			"INSERT INTO threads (id, project_path, title, created_by, last_active_at, created_at, updated_at) VALUES ('t1', ?, 'F046 live', 'u1', 1, 1, 1)",
		)
		.run(projectPath);
	const catalog: AgentCatalog = {
		version: 1,
		agents: [
			agentConfig("a1", "mock", "mock-model"),
			agentConfig("b1", "live", liveModel),
			agentConfig("c1", "live", liveModel),
		],
	};
	const accounts: AccountConfig[] = [
		{ ref: "mock", provider: "mock", apiKeyRef: "MOCK_KEY", models: ["mock-model"] },
		{ ref: "live", provider: liveProvider, apiKeyRef: liveApiKeyRef, models: [liveModel] },
	];
	const controlSocketPath = join(dir, "control.sock");
	return buildA2ARuntime({
		db: db.db,
		registry: buildRegistry(catalog, accounts),
		controlSocketPath,
		spawn: new PiWorkerSpawnPort({
			cliPath: REAL_CLI_PATH,
			sessionDir: join(dir, "sessions"),
			workerAgentDir: join(dir, "agent"),
			controlSocketPath,
			offline: true,
		}),
		clock: Date.now,
		processStartedAt: 1,
		promptTimeoutMs: 180_000,
	});
}

afterEach(async () => {
	await mock?.close();
	mock = null;
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!liveEnabled)("F046 multi_mention live provider E2E", () => {
	it("real B/C turns fan out, aggregate once, and deliver one callback", async () => {
		mock = await startMockAnthropic((request) => {
			const body = JSON.stringify(request.body);
			if (lastMessageHasToolResult(request.body)) {
				return textResponse("A_MM_TOOL_ACK");
			}
			if (body.includes("MM_CALLBACK_MARKER")) return textResponse("A_MM_FINAL");
			return toolCallResponse("superagentteam_multi_mention", {
				targets: [
					{ kind: "agent", id: "b1" },
					{ kind: "agent", id: "c1" },
				],
				question: "MM_CALLBACK_MARKER: 2+2 等于几？只回复数字。",
				callbackTo: "a1",
				triggerType: "info-gap",
			});
		});
		const runtime = makeWorld();
		await runtime.control?.start();
		const submitted = runtime.ingress.submit({
			threadId: "t1",
			userId: "u1",
			body: "please fan out @a1",
			now: 10,
		});

		const deadline = Date.now() + 90_000;
		while (Date.now() < deadline) {
			await runtime.processor.drain("t1", "u1");
			if (runtime.queue.countQueuedAll() === 0 && !runtime.tracker.has("t1")) {
				const messages = runtime.messages.getByThread("t1", 200);
				const source = messages.find((message) => message.content.startsWith("[Multi-Mention from"));
				const request = source ? runtime.multiMention.getBySourceRecordId(source.id) : null;
				const callback = request ? runtime.multiMention.getCallback(request.requestId) : null;
				if (request?.status === "done" && callback?.status === "completed") break;
			}
			await sleep(200);
		}

		const messages = runtime.messages.getByThread("t1", 200);
		const source = messages.find((message) => message.content.startsWith("[Multi-Mention from"));
		expect(source).toBeTruthy();
		const request = runtime.multiMention.getBySourceRecordId(source!.id)!;
		expect(request.status).toBe("done");
		const view = runtime.multiMention.statusView(request.requestId)!;
		expect(view.responses).toHaveLength(2);
		expect(view.responses.every((response) => response.status === "received")).toBe(true);
		expect(view.callback?.status).toBe("completed");
		expect(view.callback?.callbackToAgentId).toBe("a1");
		const aggregate = messages.find((message) => message.id === request.aggregateMessageId);
		expect(aggregate?.from).toEqual({ kind: "system", service: "multi_mention" });
		expect(runtime.records.get(`inv:t1:${request.aggregateMessageId}`)?.status).toBe("completed");
		expect(runtime.records.get(`inv:t1:${submitted.message.id}`)?.status).toBe("completed");
		expect(runtime.queue.listQueued("t1")).toHaveLength(0);
		if (process.env.SUPERAGENTTEAM_E2E_TRACE === "1") {
			console.info(
				`[f046-live] b="${runtime.messages.get(view.responses[0]!.responseMessageId!)?.content}" c="${runtime.messages.get(view.responses[1]!.responseMessageId!)?.content}" callback=${view.callback?.status}`,
			);
		}
	}, 300_000);
});
