import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createConsoleToken } from "../src/api/console-link.ts";
import { initOperatorCredential } from "../src/domains/access/operator.ts";
import { type DaemonHandle, startDaemon } from "../src/index.ts";

const HUB_ORIGIN = "http://localhost:3000";

describe("F030 account API", () => {
	let root: string;
	let dataDir: string;
	let installationRoot: string;
	let daemon: DaemonHandle | null;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "f030-account-api-"));
		dataDir = join(root, "data");
		installationRoot = join(root, "install");
		mkdirSync(installationRoot);
		initOperatorCredential({ dataDir });
		writeFileSync(join(dataDir, "agent-catalog.json"), JSON.stringify({ version: 1, agents: [] }));
		writeFileSync(join(dataDir, "accounts.json"), "[]\n");
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
			runningRevision: "f030-test",
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

	async function send(
		base: string,
		auth: { cookie: string; csrfToken: string },
		method: string,
		path: string,
		body?: unknown,
	): Promise<Response> {
		return await fetch(`${base}${path}`, {
			method,
			headers: {
				cookie: auth.cookie,
				"x-csrf-token": auth.csrfToken,
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
	}

	it("creates, lists, updates and deletes accounts without exposing secrets", async () => {
		const base = await start();
		const auth = await login(base);

		const providers = await fetch(`${base}/api/providers`, { headers: { cookie: auth.cookie } });
		expect(providers.status).toBe(200);
		const providerBody = (await providers.json()) as { providers: Array<{ id: string; envName: string }> };
		expect(providerBody.providers).toContainEqual(
			expect.objectContaining({ id: "kimi-coding", envName: "KIMI_API_KEY" }),
		);
		expect(providerBody.providers).toContainEqual(
			expect.objectContaining({
				id: "zai",
				label: "Z.AI / 智谱 GLM",
				suggestedModels: expect.arrayContaining(["glm-5.2", "glm-4.7"]),
			}),
		);

		const created = await send(base, auth, "POST", "/api/accounts", {
			ref: "kimi",
			provider: "kimi-coding",
			models: ["kimi-for-coding"],
			apiKey: "sk-test-secret",
		});
		expect(created.status).toBe(201);
		const createdText = await created.text();
		expect(createdText).not.toContain("sk-test-secret");
		expect(JSON.parse(readFileSync(join(dataDir, "accounts.json"), "utf8"))).not.toContain("sk-test-secret");
		expect(JSON.parse(readFileSync(join(dataDir, "credentials.json"), "utf8"))).toEqual({
			kimi: { apiKey: "sk-test-secret" },
		});

		const listed = await fetch(`${base}/api/accounts`, { headers: { cookie: auth.cookie } });
		const listedBody = (await listed.json()) as {
			accounts: Array<{ ref: string; credential: { kind: string }; boundAgentIds: string[] }>;
		};
		expect(listedBody.accounts).toHaveLength(1);
		expect(listedBody.accounts[0]).toMatchObject({
			ref: "kimi",
			credential: { kind: "stored" },
			boundAgentIds: [],
		});

		const updated = await send(base, auth, "PATCH", "/api/accounts/kimi", {
			displayName: "Kimi Main",
			models: ["kimi-for-coding", "kimi-k2"],
		});
		expect(updated.status).toBe(200);
		expect(await updated.json()).toMatchObject({ account: { displayName: "Kimi Main" } });
	});

	it("refuses to delete an account bound to an agent", async () => {
		const base = await start();
		const auth = await login(base);
		await send(base, auth, "POST", "/api/accounts", {
			ref: "kimi",
			provider: "kimi-coding",
			models: ["kimi-for-coding"],
			apiKey: "sk-test",
		});
		const agent = await send(base, auth, "POST", "/api/agents", {
			id: "a1",
			displayName: "Agent A1",
			mentionPatterns: ["@a1"],
			accountRef: "kimi",
			defaultModel: "kimi-for-coding",
			roleId: "worker",
		});
		expect(agent.status).toBe(201);

		const removed = await send(base, auth, "DELETE", "/api/accounts/kimi");
		expect(removed.status).toBe(409);
		expect(await removed.json()).toMatchObject({ error: "account_in_use", agentIds: ["a1"] });
	});

	it("generates a ref when the create body omits one", async () => {
		const base = await start();
		const auth = await login(base);
		const response = await send(base, auth, "POST", "/api/accounts", {
			displayName: "Kimi Main",
			provider: "kimi-coding",
			models: ["kimi-for-coding"],
			apiKey: "sk-test",
		});
		expect(response.status).toBe(201);
		const body = (await response.json()) as { account: { ref: string } };
		expect(body.account.ref).toMatch(/^kimi-main-[0-9a-f]{4}$/u);

		const credentials = JSON.parse(readFileSync(join(dataDir, "credentials.json"), "utf8")) as Record<
			string,
			unknown
		>;
		expect(credentials[body.account.ref]).toEqual({ apiKey: "sk-test" });
		const accounts = JSON.parse(readFileSync(join(dataDir, "accounts.json"), "utf8")) as Array<{ ref: string }>;
		expect(accounts.map((account) => account.ref)).toContain(body.account.ref);
	});

	it("requires CSRF and validates provider/model input", async () => {
		const base = await start();
		const auth = await login(base);
		const noCsrf = await fetch(`${base}/api/accounts`, {
			method: "POST",
			headers: { cookie: auth.cookie, "content-type": "application/json" },
			body: JSON.stringify({ ref: "x", provider: "kimi-coding", models: ["m"], apiKey: "k" }),
		});
		expect(noCsrf.status).toBe(403);

		const badProvider = await send(base, auth, "POST", "/api/accounts", {
			ref: "x",
			provider: "nope",
			models: ["m"],
			apiKey: "k",
		});
		expect(badProvider.status).toBe(422);

		const noModels = await send(base, auth, "POST", "/api/accounts", {
			ref: "x",
			provider: "kimi-coding",
			models: [],
			apiKey: "k",
		});
		expect(noModels.status).toBe(422);
	});
});
