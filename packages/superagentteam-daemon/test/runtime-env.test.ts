import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseRuntimeEnvFile, requiredEnvNames, resolveRuntimeEnv } from "../src/runtime/env.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "sat-runtime-env-"));
	dirs.push(dir);
	return dir;
}

describe("runtime env", () => {
	it("parses comments, export prefixes and quoted values", () => {
		const parsed = parseRuntimeEnvFile(
			["# comment", 'export KIMI_API_KEY="secret"', "PLAIN=value", "EMPTY="].join("\n"),
		);
		expect(parsed).toEqual({ KIMI_API_KEY: "secret", PLAIN: "value", EMPTY: "" });
	});

	it("requires env names referenced by accounts.json", () => {
		const dir = tempDir();
		writeFileSync(
			join(dir, "accounts.json"),
			JSON.stringify([
				{ ref: "kimi", apiKeyRef: "KIMI_API_KEY" },
				{ ref: "other", credential: { kind: "stored" } },
			]),
		);
		const resolved = resolveRuntimeEnv({ dataDir: dir, inherited: {} });
		expect(requiredEnvNames([{ ref: "kimi", apiKeyRef: "KIMI_API_KEY" }])).toEqual(["KIMI_API_KEY"]);
		expect(requiredEnvNames([{ ref: "kimi", credential: { kind: "env", envName: "OTHER_KEY" } }])).toEqual([
			"OTHER_KEY",
		]);
		expect(resolved.requiredEnvNames).toEqual(["KIMI_API_KEY"]);
		expect(resolved.missingEnvNames).toEqual(["KIMI_API_KEY"]);
	});

	it("inherited env wins over the env file", () => {
		const dir = tempDir();
		const envFile = join(dir, "runtime.env");
		writeFileSync(envFile, "KIMI_API_KEY=file\nOTHER=file\n");
		const resolved = resolveRuntimeEnv({
			dataDir: dir,
			envFile,
			inherited: { KIMI_API_KEY: "process" },
			requiredNames: ["KIMI_API_KEY", "OTHER"],
		});
		expect(resolved.env).toMatchObject({ KIMI_API_KEY: "process", OTHER: "file" });
		expect(resolved.missingEnvNames).toEqual([]);
	});
});
