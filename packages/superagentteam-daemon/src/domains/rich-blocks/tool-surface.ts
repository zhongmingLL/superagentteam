import { MAX_RICH_BLOCKS, type RichBlockKind } from "@superagentteam/shared/types";

// F031: one model-facing producer tool. The worker extension only carries the
// schema; the daemon control plane performs validation and draft writes.

export const RICH_BLOCK_TOOL_NAME = "superagentteam_create_rich_block";

export const RICH_BLOCK_KINDS: readonly RichBlockKind[] = [
	"card",
	"diff",
	"checklist",
	"media_gallery",
	"file",
	"audio",
	"html_widget",
	"interactive",
];

export const RICH_BLOCK_TOOL_SPEC = {
	name: RICH_BLOCK_TOOL_NAME,
	description:
		"Attach one rich block to the current response. Use only when structure helps the reader; max 20 blocks per response, 64 KiB each. interactive options are selectable; a selection returns as a user message. Never create approval or permission cards.",
	inputSchema: {
		type: "object",
		additionalProperties: false,
		required: ["block"],
		properties: {
			block: {
				type: "object",
				additionalProperties: true,
				required: ["id", "kind", "v"],
				properties: {
					id: { type: "string", minLength: 1, maxLength: 64 },
					kind: { type: "string", enum: RICH_BLOCK_KINDS },
					v: { type: "integer", const: 1 },
				},
			},
		},
	},
	maxBlocks: MAX_RICH_BLOCKS,
} as const;
