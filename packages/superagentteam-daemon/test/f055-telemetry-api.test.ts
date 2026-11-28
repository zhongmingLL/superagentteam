import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccountConfig, AgentCatalog, AgentConfig } from "@superagentteam/shared/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createConsoleToken } from "../src/api/console-link.ts";
import { initOperatorCredential } from "../src/domains/access/operator.ts";
import { type DaemonHandle, startDaemon } from "../src/index.ts";

const HUB_ORIGIN = "http://localhost:3000";
const ACCOUNT: AccountConfig = { ref: "main", provider: "pi", apiKeyRef: "KEY", models: ["m1"] };

function agentConfig(id: string): AgentConfig {
	return {
		id,
		mentionPatterns: [`@${id}`],
		displayName: `Agent ${id}`,
		contextWindow: 128_000,
		roleId: "worker",
		roleDescription: "F055 telemetry",
		restrictions: [],
		strengths: [],
		accountRef: "main",
		defaultModel: "m1",
		sessionChain: true,
		enabled: true,
	};
}

describe("F055 telemetry API", () => {
	let root: string;
	let dataDir: string;
	let installationRoot: string;
	let projectDir: string;
	let daemon: DaemonHandle | null;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "f055-telemetry-api-"));
		dataDir = join(root, "data");
		installationRoot = join(root, "install");
		projectDir = join(root, "project");
		mkdirSync(installationRoot);
		mkdirSync(projectDir);
		initOperatorCredential({ dataDir });
		const catalog: AgentCatalog = { version: 1, agents: [agentConfig("a1")] };
		writeFileSync(join(dataDir, "agent-catalog.json"), JSON.stringify(catalog));
		writeFileSync(join(dataDir, "accounts.json"), JSON.stringify([ACCOUNT]));
		daemon = null;
	});

	afterEach(async () => {
		await daemon?.stop();
		daemon = null;
		rmSync(root, { recursive: true, force: true });
	});

	async function start(): Promise<string> {
		daemon = await startDaemon({
			installationRoot,
			dataDir,
			runningRevision: "f055-telemetry-api",
			hubOrigin: HUB_ORIGIN,
			a2aControlPlane: { pollIntervalMs: 3_600_000, sweepIntervalMs: 3_600_000 },
		});
		daemon.markReady();
		return new URL(daemon.healthUrl).origin;
	}

	async function login(base: string): Promise<{ cookie: string; csrfToken: string; userId: string }> {
		const created = createConsoleToken({ dataDir, ttlMs: 60_000 });
		const exchange = await fetch(`${base}/auth/console?token=${encodeURIComponent(created.token)}`, {
			redirect: "manual",
		});
		const cookie = exchange.headers.get("set-cookie")!.split(";")[0]!;
		const session = (await fetch(`${base}/api/session`, { headers: { cookie } }).then((response) =>
			response.json(),
		)) as { csrfToken: string; userId: string };
		return { cookie, ...session };
	}

	it("serves authenticated thread-first traces, stats, metrics, logs and health", async () => {
		const base = await start();
		const auth = await login(base);
		const headers = {
			cookie: auth.cookie,
			"x-csrf-token": auth.csrfToken,
			origin: HUB_ORIGIN,
			"content-type": "application/json",
		};
		const threadResponse = await fetch(`${base}/api/threads`, {
			method: "POST",
			headers,
			body: JSON.stringify({ projectPath: projectDir, idempotencyKey: "f055-thread" }),
		});
		const thread = (await threadResponse.json()) as { id: string };

		daemon!.observability.tracer
			.startSpan({
				name: "superagentteam.turn",
				attributes: {
					"thread.id": thread.id,
					"agent.id": "a1",
					"invocation.id": "inv:1",
					"turn.execution.id": "te:1",
					"queue.entry.id": "queue:1",
					"session.id": "sess:1",
					provider: "pi",
					model: "m1",
				},
			})
			.end();
		daemon!.observability.logs?.append("info", "f055_test", { thread_id: thread.id, agent_id: "a1" });

		const response = await fetch(
			`${base}/api/messages`,
			// POST through the ingress route creates its own span.
			{
				method: "POST",
				headers,
				body: JSON.stringify({ threadId: thread.id, content: "hello @a1", idempotencyKey: "f055-msg" }),
			},
		);
		expect(response.status).toBe(202);

		const traces = await fetch(`${base}/api/telemetry/traces?threadId=${encodeURIComponent(thread.id)}&limit=20`, {
			headers: { cookie: auth.cookie },
		});
		expect(traces.status).toBe(200);
		const traceBody = (await traces.json()) as {
			availability: string;
			spans: Array<{ name: string; attributes: Record<string, string> }>;
		};
		expect(traceBody.availability).toBe("available");
		expect(traceBody.spans.some((span) => span.name === "superagentteam.turn")).toBe(true);
		expect(traceBody.spans.some((span) => span.name === "superagentteam.ingress")).toBe(true);
		expect(traceBody.spans[0]?.attributes["thread.id"]).not.toBe(thread.id);

		const turnTrace = await fetch(`${base}/api/telemetry/traces?turnExecutionId=te%3A1`, {
			headers: { cookie: auth.cookie },
		});
		expect(turnTrace.status).toBe(200);
		expect(((await turnTrace.json()) as { spans: unknown[] }).spans).toHaveLength(1);

		const stats = await fetch(`${base}/api/telemetry/traces/stats`, { headers: { cookie: auth.cookie } });
		expect(stats.status).toBe(200);
		expect(((await stats.json()) as { spanCount: number }).spanCount).toBeGreaterThan(0);

		const metrics = await fetch(`${base}/api/telemetry/metrics`, { headers: { cookie: auth.cookie } });
		expect(metrics.status).toBe(200);
		const metricBody = (await metrics.json()) as { series: Array<{ name: string }> };
		expect(metricBody.series.some((series) => series.name === "superagentteam_messages_admitted_total")).toBe(true);

		const prometheus = await fetch(`${base}/api/telemetry/metrics/prometheus`, { headers: { cookie: auth.cookie } });
		expect(prometheus.status).toBe(200);
		expect(await prometheus.text()).toContain("superagentteam_messages_admitted_total");

		const logs = await fetch(`${base}/api/telemetry/logs?limit=20`, { headers: { cookie: auth.cookie } });
		expect(logs.status).toBe(200);
		const logBody = (await logs.json()) as { availability: string; entries: Array<{ event: string }> };
		expect(logBody.availability).toBe("available");
		expect(logBody.entries.some((entry) => entry.event === "f055_test")).toBe(true);

		const health = await fetch(`${base}/api/telemetry/health`, { headers: { cookie: auth.cookie } });
		expect(health.status).toBe(200);
		const healthBody = (await health.json()) as { status: string; telemetry: { trace: { status: string } } };
		expect(healthBody.telemetry.trace.status).toBe("ready");

		const unauth = await fetch(`${base}/api/telemetry/traces`);
		expect(unauth.status).toBe(401);
		const missing = await fetch(`${base}/api/telemetry/traces?threadId=thread%3Amissing`, {
			headers: { cookie: auth.cookie },
		});
		expect(missing.status).toBe(404);
	});
});
