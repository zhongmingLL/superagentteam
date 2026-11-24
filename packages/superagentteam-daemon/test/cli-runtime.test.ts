import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "sat-cli-runtime-"));
	dirs.push(dir);
	return dir;
}

describe("CLI runtime surface", () => {
	it("advertises the runtime command", () => {
		const text = execFileSync(process.execPath, [CLI, "--help"], { encoding: "utf8" });
		expect(text).toContain("runtime <start|status|end|restart>");
		expect(text).toContain("--env-file");
	});

	it("reports not_started before the first start", () => {
		const dataDir = tempDir();
		const result = spawnSync(process.execPath, [CLI, "--data-dir", dataDir, "runtime", "status", "--json"], {
			encoding: "utf8",
		});
		expect(result.status).toBe(0);
		const body = JSON.parse(result.stdout.trim()) as { state: string; windowsProxy: string };
		expect(body).toMatchObject({ state: "not_started", windowsProxy: "not_configured" });
	});

	it("treats end without state as a no-op", () => {
		const dataDir = tempDir();
		const result = spawnSync(process.execPath, [CLI, "--data-dir", dataDir, "runtime", "end", "--json"], {
			encoding: "utf8",
		});
		expect(result.status).toBe(0);
		const body = JSON.parse(result.stdout.trim()) as { changed: boolean; state: string };
		expect(body).toMatchObject({ changed: false, state: "not_started" });
	});
});
