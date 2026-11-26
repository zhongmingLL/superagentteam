import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccountConfig, AgentCatalog } from "@superagentteam/shared/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConsoleToken } from "../src/api/console-link.ts";
import { initOperatorCredential } from "../src/auth/operator.ts";
import { type DaemonHandle, startDaemon } from "../src/index.ts";

const HUB_ORIGIN = "http://localhost:3005";
const TUNNEL_ORIGIN = "https://agentteam.hn.takin.cc";
const ACCOUNT: AccountConfig = { ref: "main", provider: "pi", apiKeyRef: "KEY", models: ["m1"] };

function consoleExchange(
	base: string,
	token: string,
	headers: Record<string, string> = {},
): Promise<{ status: number; location?: string }> {
	const url = new URL(`${base}/auth/console?token=${encodeURIComponent(token)}`);
	return new Promise((resolve, reject) => {
		const request = httpRequest(
			{
				hostname: url.hostname,
				port: url.port,
				path: `${url.pathname}${url.search}`,
				method: "GET",
				headers,
			},
			(response) => {
				response.resume();
				resolve({ status: response.statusCode ?? 0, location: response.headers.location });
			},
		);
		request.on("error", reject);
		request.end();
	});
}

describe("F041 tunnel access", () => {
	let root: string;
	let dataDir: string;
	let installationRoot: string;
	let daemon: DaemonHandle | null;
	let base: string;

	beforeEach(async () => {
		root = mkdtempSync(join(tmpdir(), "f041-tunnel-"));
		dataDir = join(root, "data");
		installationRoot = join(root, "install");
		mkdirSync(installationRoot);
		initOperatorCredential({ dataDir });
		const catalog: AgentCatalog = { version: 1, agents: [] };
		writeFileSync(join(dataDir, "agent-catalog.json"), JSON.stringify(catalog));
		writeFileSync(join(dataDir, "accounts.json"), JSON.stringify([ACCOUNT]));
		daemon = await startDaemon({
			installationRoot,
			dataDir,
			runningRevision: "f041-test",
			hubOrigin: HUB_ORIGIN,
			hubOrigins: [TUNNEL_ORIGIN],
			devAutoLogin: false,
			a2aControlPlane: { pollIntervalMs: 3_600_000, sweepIntervalMs: 3_600_000 },
		});
		daemon.markReady();
		base = new URL(daemon.healthUrl).origin;
	});

	afterEach(async () => {
		await daemon?.stop();
		daemon = null;
		rmSync(root, { recursive: true, force: true });
	});

	it("redirects a tunnel Host console exchange back to the tunnel origin", async () => {
		const created = createConsoleToken({ dataDir, ttlMs: 60_000 });
		const response = await consoleExchange(base, created.token, { host: "agentteam.hn.takin.cc" });
		expect(response.status).toBe(302);
		expect(response.location).toBe(TUNNEL_ORIGIN);
	});

	it("redirects a tunnel Origin console exchange back to the tunnel origin", async () => {
		const created = createConsoleToken({ dataDir, ttlMs: 60_000 });
		const response = await consoleExchange(base, created.token, { origin: TUNNEL_ORIGIN });
		expect(response.status).toBe(302);
		expect(response.location).toBe(TUNNEL_ORIGIN);
	});

	it("falls back to the hub origin for unknown hosts", async () => {
		const created = createConsoleToken({ dataDir, ttlMs: 60_000 });
		const response = await consoleExchange(base, created.token, { host: "evil.example" });
		expect(response.status).toBe(302);
		expect(response.location).toBe(HUB_ORIGIN);
	});
});
