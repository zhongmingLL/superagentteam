import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccountConfig, AgentCatalog, AgentConfig } from "@superagentteam/shared/types";
import { afterEach, describe, expect, it } from "vitest";

import { buildA2ARuntime } from "../src/app/a2a-runtime.ts";
import { buildRegistry } from "../src/domains/agent/registry.ts";
import { PiWorkerSpawnPort } from "../src/domains/worker/pi-spawn.ts";
import { F018Database } from "../src/infrastructure/db/database.ts";

// F048 AC-E2E (0021 standard): P layer for queue concurrency. Real pi worker +
// real provider; A runs a long real turn while B's independent entry completes.
// Run with:
//   set -a; source ~/.config/superagentteam/runtime.env; set +a
//   SUPERAGENTTEAM_LIVE_PROVIDER=1 \
//   SUPERAGENTTEAM_LIVE_PROVIDER_ID=kimi-coding \
//   SUPERAGENTTEAM_LIVE_API_KEY_REF=KIMI_API_KEY \
//   SUPERAGENTTEAM_LIVE_MODEL=kimi-for-coding \
//     npx vitest --run test/f048-queue-concurrency-live.e2e.test.ts

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
		roleDescription: "F048 live queue concurrency",
		restrictions: [],
		strengths: [],
		accountRef: "live",
		defaultModel: liveModel,
		sessionChain: true,
		enabled: true,
	};
}

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(check: () => T | null, timeoutMs = 60_000): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = check();
		if (value !== null) return value;
		await sleep(100);
	}
	throw new Error("timed out waiting for F048 live state");
}

function makeWorld(): {
	runtime: ReturnType<typeof buildA2ARuntime>;
	logs: Array<{ event: string; fields: Record<string, unknown> | undefined }>;
} {
	const dir = mkdtempSync(join(tmpdir(), "f048-live-"));
	dirs.push(dir);
	const projectPath = join(dir, "project");
	mkdirSync(projectPath, { recursive: true });
	const db = new F018Database({ path: join(dir, "f048-live.db") });
	db.db
		.prepare(
			"INSERT INTO threads (id, project_path, title, created_by, last_active_at, created_at, updated_at) VALUES ('t1', ?, 'F048 live', 'u1', 1, 1, 1)",
		)
		.run(projectPath);
	const catalog: AgentCatalog = { version: 1, agents: [agentConfig("a1"), agentConfig("b1")] };
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
		promptTimeoutMs: 180_000,
		log: (_level, event, fields) => logs.push({ event, fields }),
	});
	return { runtime, logs };
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!liveEnabled)("F048 queue concurrency live provider E2E", () => {
	it("real provider: B's independent entry completes while A's long turn is still running", async () => {
		const { runtime, logs } = makeWorld();
		const aEntry = runtime.ingress.submit({
			threadId: "t1",
			userId: "u1",
			body: "@a1 请用中文写一段至少 500 字的说明，主题是“线程优先运行时为什么需要 per-agent 队列”。不要省略，直接输出正文。",
			now: 10,
		});
		const aInvocation = `inv:t1:${aEntry.message.id}`;
		const aDrain = runtime.processor.drain("t1", "u1");
		const aRunning = await waitFor(() => {
			const attempt = runtime.attempts.getLatest(aInvocation, "a1");
			return attempt?.deliveryState === "appended" ? attempt : null;
		}, 60_000);

		const bEntry = runtime.ingress.submit({
			threadId: "t1",
			userId: "u1",
			body: "@b1 请只回复：F048_LIVE_B_OK（不要回复其他内容）",
			now: 20,
		});
		const bInvocation = `inv:t1:${bEntry.message.id}`;
		const bDrain = runtime.processor.drain("t1", "u1");
		await bDrain;

		const bAttempt = runtime.attempts.getLatest(bInvocation, "b1")!;
		expect(runtime.messages.get(bAttempt.responseMessageId!)?.content).toContain("F048_LIVE_B_OK");
		// A must still be running when B completed.
		expect(runtime.attempts.getLatest(aInvocation, "a1")?.deliveryState).toBe("appended");
		expect(runtime.turns.get(aRunning.turnExecutionId!)?.status).toBe("running");

		await aDrain;
		const aFinal = runtime.attempts.getLatest(aInvocation, "a1")!;
		expect(aFinal.deliveryState).toBe("handled");
		expect(runtime.messages.get(aFinal.responseMessageId!)?.content.length).toBeGreaterThan(100);
		const terminals = logs.filter((entry) => entry.event === "turn_terminal");
		expect(terminals.length).toBeGreaterThanOrEqual(2);

		if (process.env.SUPERAGENTTEAM_E2E_TRACE === "1") {
			console.info(
				`[f048-live] A length=${runtime.messages.get(aFinal.responseMessageId!)?.content.length} B="${runtime.messages.get(bAttempt.responseMessageId!)?.content}"`,
			);
		}
	}, 240_000);
});
