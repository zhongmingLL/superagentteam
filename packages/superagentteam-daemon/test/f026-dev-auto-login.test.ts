import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccountConfig, AgentCatalog, AgentConfig } from "@superagentteam/shared/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initOperatorCredential, operatorCredentialPaths } from "../src/auth/operator.ts";
import { type DaemonHandle, startDaemon } from "../src/index.ts";

const HUB_ORIGIN = "http://localhost:3000";
const ACCOUNT: AccountConfig = { ref: "main", provider: "pi", apiKeyRef: "KEY", models: ["m1"] };

function agentConfig(): AgentConfig {
	return {
		id: "a1",
		mentionPatterns: ["@a1"],
		displayName: "Agent a1",
		contextWindow: 128_000,
		roleId: "worker",
		roleDescription: "does things",
		restrictions: [],
		strengths: [],
		accountRef: "main",
		defaultModel: "m1",
		sessionChain: true,
		enabled: true,
	};
}

describe("F026 dev auto-login", () => {
	let root: string;
	let dataDir: string;
	let installationRoot: string;
	let daemon: DaemonHandle | null;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "f026-dev-login-"));
		dataDir = join(root, "data");
		installationRoot = join(root, "install");
		mkdirSync(installationRoot);
		initOperatorCredential({ dataDir });
		const catalog: AgentCatalog = { version: 1, agents: [agentConfig()] };
		writeFileSync(join(dataDir, "agent-catalog.json"), JSON.stringify(catalog));
		writeFileSync(join(dataDir, "accounts.json"), JSON.stringify([ACCOUNT]));
		daemon = null;
	});

	afterEach(async () => {
		await daemon?.stop();
		daemon = null;
		rmSync(root, { recursive: true, force: true });
	});

	async function start(devAutoLogin: boolean, hubOrigins: readonly string[] = []): Promise<string> {
		daemon = await startDaemon({
			installationRoot,
			dataDir,
			runningRevision: "f026-test",
			hubOrigin: HUB_ORIGIN,
			hubOrigins,
			devAutoLogin,
			a2aControlPlane: { pollIntervalMs: 3_600_000, sweepIntervalMs: 3_600_000 },
		});
		daemon.markReady();
		return new URL(daemon.healthUrl).origin;
	}

	it("creates a loopback operator session without a console link", async () => {
		const base = await start(true);
		const response = await fetch(`${base}/api/session`);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { userId: string; csrfToken: string };
		expect(body.userId).toBe(`operator:${operatorCredentialPaths(dataDir).fingerprint}`);
		expect(body.csrfToken).toMatch(/[0-9a-f-]{36}/);
		const cookie = response.headers.get("set-cookie")!.split(";")[0]!;

		const agents = await fetch(`${base}/api/agents`, { headers: { cookie } });
		expect(agents.status).toBe(200);
		const agentBody = (await agents.json()) as { agents: Array<{ id: string }> };
		expect(agentBody.agents.map((agent) => agent.id)).toEqual(["a1"]);
	});

	it("keeps CSRF required for writes", async () => {
		const base = await start(true);
		const response = await fetch(`${base}/api/session`);
		const session = (await response.json()) as { csrfToken: string };
		const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
		const input = {
			id: "a2",
			displayName: "Agent a2",
			mentionPatterns: ["@a2"],
			accountRef: "main",
			defaultModel: "m1",
			roleId: "worker",
		};

		const noCsrf = await fetch(`${base}/api/agents`, {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify(input),
		});
		expect(noCsrf.status).toBe(403);

		const withCsrf = await fetch(`${base}/api/agents`, {
			method: "POST",
			headers: { cookie, "content-type": "application/json", "x-csrf-token": session.csrfToken },
			body: JSON.stringify(input),
		});
		expect(withCsrf.status).toBe(201);
	});

	it("keeps the strict 401 path when devAutoLogin is off", async () => {
		const base = await start(false);
		expect((await fetch(`${base}/api/session`)).status).toBe(401);
		expect((await fetch(`${base}/api/agents`)).status).toBe(401);
	});

	it("accepts a configured tunnel origin while rejecting unknown origins", async () => {
		const tunnelOrigin = "https://agentteam.hn.takin.cc";
		const base = await start(true, [tunnelOrigin]);

		const response = await fetch(`${base}/api/session`, { headers: { origin: tunnelOrigin } });
		expect(response.status).toBe(200);
		const session = (await response.json()) as { csrfToken: string };
		const cookie = response.headers.get("set-cookie")!.split(";")[0]!;

		const write = await fetch(`${base}/api/agents`, {
			method: "POST",
			headers: {
				origin: tunnelOrigin,
				cookie,
				"content-type": "application/json",
				"x-csrf-token": session.csrfToken,
			},
			body: JSON.stringify({
				id: "a2",
				displayName: "Agent a2",
				mentionPatterns: ["@a2"],
				accountRef: "main",
				defaultModel: "m1",
				roleId: "worker",
			}),
		});
		expect(write.status).toBe(201);

		const localhost = await fetch(`${base}/api/session`, { headers: { origin: HUB_ORIGIN } });
		expect(localhost.status).toBe(200);

		const unknown = await fetch(`${base}/api/session`, { headers: { origin: "https://evil.example" } });
		expect(unknown.status).toBe(403);
	});
});
