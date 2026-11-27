import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// F050 AC-1/AC-2/AC-3: mechanical guard for the alignment close-out. It does
// not re-run runtime behavior (the real suites do that); it keeps the docs,
// feature links, PR template, and audit dispositions from silently drifting.

const root = join(import.meta.dirname, "..", "..", "..");

function read(path: string): string {
	return readFileSync(join(root, path), "utf8");
}

describe("F050 parity guard", () => {
	it("0007 keeps the F044–F046 contract markers and no C2 column-level UNIQUE", () => {
		const doc = read("docs/architecture/0007-a2a-runtime-chain.md");
		for (const marker of [
			"Trigger snapshot（F045）",
			"successor admission（F046b）",
			"superagentteam_create_rich_block",
			"multi_mention_auto_delivery",
			"MessageDispatchSummary",
		]) {
			expect(doc).toContain(marker);
		}
		expect(doc).toMatch(/source_record_id TEXT NOT NULL(?! UNIQUE)/);
		expect(doc).not.toMatch(/source_record_id TEXT NOT NULL UNIQUE/);
		expect(doc).toContain("json_type(owner_json) = 'object'");
		expect(doc).toContain("json_type(from_json) = 'object'");
		expect(doc).toContain("UNIQUE (thread_id, source_record_id)");
	});

	it("0019 records the final as-built decisions and F046b flush", () => {
		const doc = read("docs/architecture/0019-a2a-runtime-chain-as-built.md");
		for (const marker of ["intentional merge", "statusView", "pending successor", "F046"]) {
			expect(doc).toContain(marker);
		}
	});

	it("AGENTS and every F044–F051 feature doc point at the 0021 standard", () => {
		expect(existsSync(join(root, "docs/architecture/0021-e2e-acceptance-standard.md"))).toBe(true);
		expect(read("AGENTS.md")).toContain("0021-e2e-acceptance-standard.md");
		for (const file of [
			"F044-a2a-route-layer.md",
			"F045-a2a-context-history.md",
			"F046-a2a-tools-multi-mention.md",
			"F047-a2a-data-api-parity.md",
			"F048-a2a-queue-concurrency.md",
			"F050-a2a-parity-guard.md",
			"F051-daemon-module-layout.md",
		]) {
			expect(read(`docs/features/${file}`), file).toContain("0021-e2e-acceptance-standard.md");
		}
	});

	it("the audit close-out has a disposition for every A–F row", () => {
		const report = read("docs/reports/2026-11-28-a2a-alignment-close.md");
		const rows = [
			"A1",
			"A2",
			"A3",
			"A4",
			"A5",
			"A6",
			"A7",
			"A8",
			"A9",
			"B1",
			"B2",
			"B3",
			"B4",
			"B5",
			"B6",
			"B7",
			"B8",
			"B9",
			"C1",
			"C2",
			"C3",
			"C4",
			"C5",
			"C6",
			"D1",
			"D2",
			"D3",
			"D4",
			"D5",
			"D6",
			"D7–D9",
			"E1",
			"E2",
			"E3",
			"E4",
			"E5",
			"F1–F4",
			"F5",
			"F6–F7",
			"F8",
		];
		for (const row of rows) expect(report, row).toContain(`| ${row} |`);
	});

	it("the PR template requires architecture delta + 0021 E2E evidence", () => {
		const template = read(".github/pull_request_template.md");
		expect(template).toContain("Architecture delta (0007 / 0019 / audit)");
		expect(template).toContain("E2E evidence (0021 method)");
		expect(template).toContain("No fresh E2E = not verified");
	});
});
