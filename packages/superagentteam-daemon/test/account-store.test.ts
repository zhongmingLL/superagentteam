import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AccountError, AccountStore } from "../src/domains/accounts/store.ts";

function tempStore(): { store: AccountStore; accountsPath: string; credentialsPath: string } {
	const dir = mkdtempSync(join(tmpdir(), "sat-account-"));
	const accountsPath = join(dir, "accounts.json");
	const credentialsPath = join(dir, "credentials.json");
	writeFileSync(accountsPath, "[]\n", { mode: 0o600 });
	return { store: new AccountStore({ accountsPath, credentialsPath }), accountsPath, credentialsPath };
}

describe("account store", () => {
	it("stores an API key outside accounts.json and resolves it by ref", () => {
		const { store, accountsPath, credentialsPath } = tempStore();
		const account = store.create({
			ref: "kimi-main",
			displayName: "Kimi Main",
			provider: "kimi-coding",
			models: ["kimi-for-coding"],
			apiKey: "sk-test",
		});
		expect(account.apiKeyRef).toBe("secret:kimi-main");
		const accountsRaw = readFileSync(accountsPath, "utf8");
		expect(accountsRaw).not.toContain("sk-test");
		expect(JSON.parse(accountsRaw)).toEqual([
			{
				ref: "kimi-main",
				displayName: "Kimi Main",
				provider: "kimi-coding",
				apiKeyRef: "secret:kimi-main",
				models: ["kimi-for-coding"],
			},
		]);
		expect(JSON.parse(readFileSync(credentialsPath, "utf8"))).toEqual({ "kimi-main": { apiKey: "sk-test" } });
		expect(statSync(credentialsPath).mode & 0o777).toBe(0o600);
		expect(store.credentialKind(account)).toEqual({ kind: "stored" });
		expect(store.resolveApiKey(account)).toBe("sk-test");
	});

	it("supports an env reference without writing a secret", () => {
		const { store, credentialsPath } = tempStore();
		const account = store.create({
			ref: "env-kimi",
			provider: "kimi-coding",
			models: ["kimi-for-coding"],
			envName: "KIMI_API_KEY",
		});
		expect(account.apiKeyRef).toBe("ENV:KIMI_API_KEY");
		expect(store.credentialKind(account)).toEqual({ kind: "env", envName: "KIMI_API_KEY" });
		expect(store.resolveApiKey(account)).toBe(process.env.KIMI_API_KEY);
		expect(() => readFileSync(credentialsPath, "utf8")).toThrow();
	});

	it("rejects duplicate refs, unknown providers, empty models and bad URLs", () => {
		const { store } = tempStore();
		store.create({ ref: "a", provider: "kimi-coding", models: ["m"], apiKey: "k" });
		expect(() => store.create({ ref: "a", provider: "kimi-coding", models: ["m"], apiKey: "k" })).toThrow(
			AccountError,
		);
		expect(() => store.create({ ref: "b", provider: "nope", models: ["m"], apiKey: "k" })).toThrow(AccountError);
		expect(() => store.create({ ref: "c", provider: "openai", models: [], apiKey: "k" })).toThrow(AccountError);
		expect(() =>
			store.create({ ref: "d", provider: "openai", models: ["m"], apiKey: "k", apiUrl: "javascript:alert(1)" }),
		).toThrow(AccountError);
		expect(() => store.create({ ref: "e", provider: "amazon-bedrock", models: ["m"], apiKey: "k" })).toThrowError(
			expect.objectContaining({ code: "unsupported_provider_auth" }),
		);
	});

	it("rotates a stored key and can switch to an env reference", () => {
		const { store } = tempStore();
		store.create({ ref: "a", provider: "openai", models: ["gpt"], apiKey: "old" });
		const updated = store.update("a", { apiKey: "new" });
		expect(store.resolveApiKey(updated)).toBe("new");
		const env = store.update("a", { envName: "OPENAI_API_KEY" });
		expect(env.apiKeyRef).toBe("ENV:OPENAI_API_KEY");
		expect(store.credentialKind(env)).toEqual({ kind: "env", envName: "OPENAI_API_KEY" });
	});

	it("deletes both the account and its stored credential", () => {
		const { store, credentialsPath } = tempStore();
		store.create({ ref: "a", provider: "openai", models: ["gpt"], apiKey: "k" });
		store.remove("a");
		expect(store.list()).toEqual([]);
		expect(JSON.parse(readFileSync(credentialsPath, "utf8"))).toEqual({});
		expect(() => store.remove("a")).toThrow(AccountError);
	});
});
