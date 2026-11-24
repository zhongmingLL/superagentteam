import type { ControlMigration } from "./index.ts";

/**
 * F031: rich blocks are staged on the durable response draft, then committed
 * to the final response message by T2/T4. The column is intentionally separate
 * from content/tool_events so ResponseEventSink's full-snapshot flush cannot
 * overwrite a block created by the worker tool.
 */
export const RICH_BLOCK_STATEMENTS = [
	`ALTER TABLE response_drafts ADD COLUMN rich_blocks_json TEXT NOT NULL DEFAULT '[]'
		CHECK (json_valid(rich_blocks_json) AND json_type(rich_blocks_json) = 'array')`,
] as const;

export const RICH_BLOCK_DOWNS = [`ALTER TABLE response_drafts DROP COLUMN rich_blocks_json`] as const;

export const richBlockMigration: ControlMigration = {
	version: 7,
	name: "rich-blocks",
	up: [...RICH_BLOCK_STATEMENTS],
	down: [...RICH_BLOCK_DOWNS],
};
