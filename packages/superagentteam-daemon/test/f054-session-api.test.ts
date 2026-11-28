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
		roleDescription: "F054 sessions",
		restrictions: [],
		strengths: [],
		accountRef: "main",
		defaultModel: "m1",
		sessionChain: true,
		enabled: true,
	};
}

describe("F054 session chain API", () => {
	let root: string;
	let dataDir: string;
	let installationRoot: string;
	let projectDir: string;
	let daemon: DaemonHandle | null;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "f054-session-api-"));
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
			runningRevision: "f054-session-api",
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

	it("lists a chain, seals an idle session and reads transcript/digest", async () => {
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
			body: JSON.stringify({ projectPath: projectDir, idempotencyKey: "f054-thread" }),
		});
		expect(threadResponse.status).toBe(201);
		const thread = (await threadResponse.json()) as { id: string };
		const runtime = daemon!.a2aControlPlane!.runtime;
		const session = runtime.sessions.ensureActive({
			threadId: thread.id,
			agentId: "a1",
			userId: auth.userId,
			workingDirectory: projectDir,
			now: 1_000,
		});
		runtime.messages.append({
			id: "m1",
			threadId: thread.id,
			from: { kind: "user", userId: auth.userId },
			content: "seal me",
			now: 1_100,
		});
		runtime.messages.append({
			id: "m2",
			threadId: thread.id,
			from: { kind: "agent", agentId: "a1" },
			content: "sealed reply",
			now: 1_200,
		});

		const chain = await fetch(`${base}/api/threads/${encodeURIComponent(thread.id)}/sessions`, {
			headers: { cookie: auth.cookie },
		});
		expect(chain.status).toBe(200);
		const chainBody = (await chain.json()) as {
			sessions: Array<{ id: string; seq: number; status: string; hasArtifact: boolean }>;
		};
		expect(chainBody.sessions).toEqual([
			expect.objectContaining({ id: session.id, seq: 0, status: "active", hasArtifact: false }),
		]);

		const noCsrf = await fetch(`${base}/api/sessions/${encodeURIComponent(session.id)}/seal`, {
			method: "POST",
			headers: { cookie: auth.cookie, origin: HUB_ORIGIN, "content-type": "application/json" },
			body: "{}",
		});
		expect(noCsrf.status).toBe(403);

		const sealed = await fetch(`${base}/api/sessions/${encodeURIComponent(session.id)}/seal`, {
			method: "POST",
			headers,
			body: JSON.stringify({ reason: "manual" }),
		});
		expect(sealed.status).toBe(200);
		const sealedBody = (await sealed.json()) as {
			session: { status: string; sealReason: string };
			artifact: { messageCount: number; digest: { senders: { user: number; agents: Record<string, number> } } };
		};
		expect(sealedBody.session).toMatchObject({ status: "sealed", sealReason: "manual" });
		expect(sealedBody.artifact.messageCount).toBe(2);
		expect(sealedBody.artifact.digest.senders).toEqual({ user: 1, agents: { a1: 1 }, system: 0 });

		const detail = await fetch(`${base}/api/sessions/${encodeURIComponent(session.id)}`, {
			headers: { cookie: auth.cookie },
		});
		expect(detail.status).toBe(200);
		const detailBody = (await detail.json()) as { session: { status: string }; artifact: { messageCount: number } };
		expect(detailBody.session.status).toBe("sealed");
		expect(detailBody.artifact.messageCount).toBe(2);

		const transcript = await fetch(`${base}/api/sessions/${encodeURIComponent(session.id)}/transcript`, {
			headers: { cookie: auth.cookie },
		});
		expect(transcript.status).toBe(200);
		const transcriptBody = (await transcript.json()) as { transcript: Array<{ content: string }> };
		expect(transcriptBody.transcript.map((entry) => entry.content)).toEqual(["seal me", "sealed reply"]);

		const sealedAgain = await fetch(`${base}/api/sessions/${encodeURIComponent(session.id)}/seal`, {
			method: "POST",
			headers,
			body: "{}",
		});
		expect(sealedAgain.status).toBe(409);
	});
});
