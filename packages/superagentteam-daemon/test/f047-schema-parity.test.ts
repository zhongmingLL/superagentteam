import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { F018Database } from "../src/infrastructure/db/database.ts";

// F047 AC-1/AC-2: the live sqlite_master must match the 0007 target DDL for
// the audited C1–C4 items. This is the mechanical reconciliation artifact; the
// real-chain evidence comes from the route fullstack suites.

const dirs: string[] = [];

/** Every non-internal table a fresh F018 DB must have (two-way documented). */
const CANONICAL_TABLES = [
	"agent_read_state",
	"agent_sessions",
	"invocation_attempts",
	"invocation_credentials",
	"invocation_queue",
	"invocation_records",
	"messages",
	"multi_mention_callbacks",
	"multi_mention_requests",
	"multi_mention_responses",
	"queue_admissions",
	"response_drafts",
	"session_artifacts",
	"thread_participants",
	"thread_read_state",
	"threads",
	"turn_executions",
	"worker_bindings",
	"workers",
] as const;

function tableSql(db: F018Database, name: string): string {
	const row = db.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as
		| { sql: string }
		| undefined;
	expect(row, `table ${name} missing`).toBeTruthy();
	return row!.sql.replace(/\s+/g, " ").trim();
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("F047 schema parity (0007 §4 / §9.2)", () => {
	it("live DDL carries rich_blocks_json, thread-scoped unique, and object JSON checks", () => {
		const dir = mkdtempSync(join(tmpdir(), "f047-schema-"));
		dirs.push(dir);
		const db = new F018Database({ path: join(dir, "f047.db") });

		const drafts = tableSql(db, "response_drafts");
		expect(drafts).toContain("rich_blocks_json TEXT NOT NULL DEFAULT '[]'");
		expect(drafts).toContain("json_type(rich_blocks_json) = 'array'");

		const records = tableSql(db, "invocation_records");
		expect(records).toContain("UNIQUE (thread_id, source_record_id)");
		expect(records).not.toMatch(/source_record_id TEXT NOT NULL UNIQUE/);

		const queue = tableSql(db, "invocation_queue");
		expect(queue).toContain("json_type(owner_json) = 'object'");
		expect(queue).toContain("json_type(from_json) = 'object'");

		// C4: two-way canonical table check. A new table that is not documented
		// here (or a documented table that is missing) fails this test.
		for (const name of CANONICAL_TABLES) {
			expect(tableSql(db, name).length, `table ${name}`).toBeGreaterThan(0);
		}
		const liveTables = (
			db.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{
				name: string;
			}>
		)
			.map((row) => row.name)
			.filter((name) => name !== "f018_schema_migrations" && !name.startsWith("sqlite_"));
		expect(liveTables).toEqual([...CANONICAL_TABLES]);
		db.db.close();
	});
});
