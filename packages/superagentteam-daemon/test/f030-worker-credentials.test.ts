import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccountConfig } from "@superagentteam/shared/types";
import { describe, expect, it } from "vitest";

import { prepareWorkerAgentDir } from "../src/domains/worker/pi-spawn.ts";

function account(overrides: Partial<AccountConfig> = {}): AccountConfig {
	return {
		ref: "kimi",
		provider: "kimi-coding",
		apiKeyRef: "secret:kimi",
		models: ["kimi-for-coding"],
		...overrides,
	};
}

describe("F030 worker credential isolation", () => {
	it("writes a per-worker auth.json with the account key", () => {
		const agentDir = join(mkdtempSync(join(tmpdir(), "f030-worker-")), "worker-1");
		prepareWorkerAgentDir(agentDir, account(), "sk-account");
		const auth = JSON.parse(readFileSync(join(agentDir, "auth.json"), "utf8"));
		expect(auth).toEqual({ "kimi-coding": { type: "api_key", key: "sk-account" } });
		expect(statSync(join(agentDir, "auth.json")).mode & 0o777).toBe(0o600);
	});

	it("writes a models.json baseUrl override when the account has apiUrl", () => {
		const agentDir = join(mkdtempSync(join(tmpdir(), "f030-worker-")), "worker-2");
		prepareWorkerAgentDir(agentDir, account({ apiUrl: "https://gateway.example/v1" }), "sk-account");
		expect(JSON.parse(readFileSync(join(agentDir, "models.json"), "utf8"))).toEqual({
			providers: { "kimi-coding": { baseUrl: "https://gateway.example/v1" } },
		});
	});

	it("fails closed when a stored secret is missing", () => {
		const agentDir = join(mkdtempSync(join(tmpdir(), "f030-worker-")), "worker-3");
		expect(() => prepareWorkerAgentDir(agentDir, account(), undefined)).toThrow(/worker_credential_missing/);
	});

	it("allows legacy env-backed accounts without writing auth.json", () => {
		const agentDir = join(mkdtempSync(join(tmpdir(), "f030-worker-")), "worker-4");
		prepareWorkerAgentDir(agentDir, account({ apiKeyRef: "ENV:KIMI_API_KEY" }), undefined);
		expect(existsSync(agentDir)).toBe(true);
		expect(existsSync(join(agentDir, "auth.json"))).toBe(false);
	});
});
