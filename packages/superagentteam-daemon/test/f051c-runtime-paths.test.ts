import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePiCliPath } from "../src/app/daemon-a2a.ts";
import { resolveWebDistPath } from "../src/app/daemon.ts";

// F051a moved the composition roots from src/ into src/app/. These resolvers
// are anchored on import.meta.url, so their relative depth must move with the
// file. A wrong depth is invisible to typecheck/tests until a real worker
// spawn or static-file serve fails in production.

describe("F051c runtime path anchors", () => {
	const packagesRoot = join(import.meta.dirname, "..", "..");

	it("resolves the pi CLI under packages/coding-agent", () => {
		expect(resolvePiCliPath()).toBe(join(packagesRoot, "coding-agent", "dist", "cli.js"));
	});

	it("resolves the web dist under packages/superagentteam-web", () => {
		expect(resolveWebDistPath()).toBe(join(packagesRoot, "superagentteam-web", "dist"));
	});
});
