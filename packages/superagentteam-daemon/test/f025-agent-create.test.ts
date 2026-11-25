import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccountConfig, AgentCatalog, AgentConfig } from "@superagentteam/shared/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createConsoleToken } from "../src/api/console-link.ts";
import { initOperatorCredential } from "../src/auth/operator.ts";
import { type DaemonHandle, startDaemon } from "../src/index.ts";

const HUB_ORIGIN = "http://localhost:3000";
const ACCOUNT: AccountConfig = {
	ref: "main",
	provider: "kimi-coding",
	apiKeyRef: "KIMI_API_KEY",
	models: ["kimi-for-coding"],
};

function agentConfig(id: string, enabled = true): AgentConfig {
	return {
		id,
		mentionPatterns: [`@${id}`],
		displayName: `Agent ${id}`,
		contextWindow: 128_000,
		roleId: "worker",
		roleDescription: "does things",
		restrictions: [],
		strengths: [],
		accountRef: "main",
		defaultModel: "kimi-for-coding",
		sessionChain: true,
		enabled,
	};
}

describe("F025 agent create API", () => {
	let root: string;
	let dataDir: string;
	let installationRoot: string;
	let daemon: DaemonHandle | null;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "f025-agent-create-"));
		dataDir = join(root, "data");
		installationRoot = join(root, "install");
		mkdirSync(installationRoot);
		initOperatorCredential({ dataDir });
		const catalog: AgentCatalog = { version: 1, agents: [agentConfig("a1"), agentConfig("a2", false)] };
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
			runningRevision: "f025-test",
			hubOrigin: HUB_ORIGIN,
			a2aControlPlane: { pollIntervalMs: 3_600_000, sweepIntervalMs: 3_600_000 },
		});
		daemon.markReady();
		return new URL(daemon.healthUrl).origin;
	}

	async function login(base: string): Promise<{ cookie: string; csrfToken: string }> {
		const created = createConsoleToken({ dataDir, ttlMs: 60_000 });
		const exchange = await fetch(`${base}/auth/console?token=${encodeURIComponent(created.token)}`, {
			redirect: "manual",
		});
		const cookie = exchange.headers.get("set-cookie")!.split(";")[0]!;
		const session = (await fetch(`${base}/api/session`, { headers: { cookie } }).then((response) =>
			response.json(),
		)) as { csrfToken: string };
		return { cookie, csrfToken: session.csrfToken };
	}

	function createInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
		return {
			id: "a3",
			displayName: "Agent a3",
			mentionPatterns: ["@a3", "@alpha"],
			accountRef: "main",
			defaultModel: "kimi-for-coding",
			roleId: "worker",
			...overrides,
		};
	}

	async function postAgent(
		base: string,
		auth: { cookie: string; csrfToken: string },
		body: Record<string, unknown>,
	): Promise<Response> {
		return await fetch(`${base}/api/agents`, {
			method: "POST",
			headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken, "content-type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	it("projects accounts without secrets", async () => {
		const base = await start();
		const auth = await login(base);
		const response = await fetch(`${base}/api/accounts`, { headers: { cookie: auth.cookie } });
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			accounts: Array<{
				ref: string;
				provider: string;
				providerLabel: string;
				models: string[];
				credential: { kind: string; envName?: string };
				boundAgentIds: string[];
				apiKeyRef?: string;
				apiUrl?: string;
			}>;
		};
		expect(body.accounts).toMatchObject([
			{
				ref: "main",
				provider: "kimi-coding",
				providerLabel: "Kimi For Coding",
				models: ["kimi-for-coding"],
				credential: { kind: "env", envName: "KIMI_API_KEY" },
				boundAgentIds: ["a1", "a2"],
			},
		]);
		expect(body.accounts[0]).not.toHaveProperty("apiKeyRef");
		expect(body.accounts[0]).not.toHaveProperty("apiUrl");
	});

	it("creates an agent, persists the catalog, and hot-reloads routing", async () => {
		const base = await start();
		const auth = await login(base);
		const before = daemon!.a2aControlPlane!.registry.revision;

		const response = await postAgent(base, auth, createInput());
		expect(response.status).toBe(201);
		const body = (await response.json()) as { agent: { id: string; displayName: string; enabled: boolean } };
		expect(body.agent).toMatchObject({ id: "a3", displayName: "Agent a3", enabled: true });

		const registry = daemon!.a2aControlPlane!.registry;
		expect(registry.revision).toBeGreaterThan(before);
		expect(registry.agents.get("a3")?.displayName).toBe("Agent a3");
		expect(registry.mentionIndex.get("@alpha")).toBe("a3");

		const persisted = JSON.parse(readFileSync(join(dataDir, "agent-catalog.json"), "utf8")) as AgentCatalog;
		expect(persisted.agents.map((agent) => agent.id)).toEqual(["a1", "a2", "a3"]);

		const listed = (await fetch(`${base}/api/agents`, { headers: { cookie: auth.cookie } }).then((item) =>
			item.json(),
		)) as { agents: Array<{ id: string }> };
		expect(listed.agents.map((agent) => agent.id)).toContain("a3");
	});

	it("generates an id when the create body omits one", async () => {
		const base = await start();
		const auth = await login(base);
		const input = createInput({ displayName: "Agent A" });
		delete (input as { id?: unknown }).id;

		const response = await postAgent(base, auth, input);
		expect(response.status).toBe(201);
		const body = (await response.json()) as { agent: { id: string; displayName: string } };
		expect(body.agent.displayName).toBe("Agent A");
		expect(body.agent.id).toMatch(/^agent-a-[0-9a-f]{4}$/u);

		const persisted = JSON.parse(readFileSync(join(dataDir, "agent-catalog.json"), "utf8")) as AgentCatalog;
		expect(persisted.agents.some((agent) => agent.id === body.agent.id)).toBe(true);
	});

	it("updates an existing agent and revalidates account/model", async () => {
		const base = await start();
		const auth = await login(base);
		const response = await fetch(`${base}/api/agents/a1`, {
			method: "PATCH",
			headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken, "content-type": "application/json" },
			body: JSON.stringify({
				displayName: "Agent A1 renamed",
				mentionPatterns: ["@a1x"],
				defaultModel: "kimi-for-coding",
			}),
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as { agent: { displayName: string; mentionPatterns: string[] } };
		expect(body.agent).toMatchObject({ displayName: "Agent A1 renamed", mentionPatterns: ["@a1x"] });
		const catalog = JSON.parse(readFileSync(join(dataDir, "agent-catalog.json"), "utf8")) as {
			agents: Array<{ id: string; displayName: string }>;
		};
		expect(catalog.agents.find((agent) => agent.id === "a1")?.displayName).toBe("Agent A1 renamed");

		const badModel = await fetch(`${base}/api/agents/a1`, {
			method: "PATCH",
			headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken, "content-type": "application/json" },
			body: JSON.stringify({ defaultModel: "not-in-account" }),
		});
		expect(badModel.status).toBe(422);

		const missing = await fetch(`${base}/api/agents/nope`, {
			method: "PATCH",
			headers: { cookie: auth.cookie, "x-csrf-token": auth.csrfToken, "content-type": "application/json" },
			body: JSON.stringify({ displayName: "x" }),
		});
		expect(missing.status).toBe(404);
	});

	it("rejects duplicate ids and mention patterns without mutating the catalog", async () => {
		const base = await start();
		const auth = await login(base);
		const before = readFileSync(join(dataDir, "agent-catalog.json"), "utf8");

		const duplicateId = await postAgent(base, auth, createInput({ id: "a1" }));
		expect(duplicateId.status).toBe(409);
		expect(((await duplicateId.json()) as { error: string }).error).toBe("agent_exists");

		const duplicateMention = await postAgent(base, auth, createInput({ mentionPatterns: ["@a1"] }));
		expect(duplicateMention.status).toBe(409);
		expect(((await duplicateMention.json()) as { error: string }).error).toBe("mention_pattern_conflict");

		expect(readFileSync(join(dataDir, "agent-catalog.json"), "utf8")).toBe(before);
	});

	it("rejects unknown accounts and models", async () => {
		const base = await start();
		const auth = await login(base);

		const account = await postAgent(base, auth, createInput({ accountRef: "nope" }));
		expect(account.status).toBe(422);
		expect(((await account.json()) as { error: string }).error).toBe("account_not_found");

		const model = await postAgent(base, auth, createInput({ defaultModel: "unknown-model" }));
		expect(model.status).toBe(422);
		expect(((await model.json()) as { error: string }).error).toBe("model_not_in_account");
	});

	it("requires auth, CSRF, and a valid body", async () => {
		const base = await start();
		expect(
			(
				await fetch(`${base}/api/agents`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(createInput()),
				})
			).status,
		).toBe(401);

		const auth = await login(base);
		const noCsrf = await fetch(`${base}/api/agents`, {
			method: "POST",
			headers: { cookie: auth.cookie, "content-type": "application/json" },
			body: JSON.stringify(createInput()),
		});
		expect(noCsrf.status).toBe(403);

		const invalid = await postAgent(base, auth, createInput({ displayName: "" }));
		expect(invalid.status).toBe(400);
		expect(((await invalid.json()) as { error: string }).error).toBe("invalid_input");
	});
});
