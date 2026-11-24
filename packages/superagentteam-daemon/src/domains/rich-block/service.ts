import {
	MAX_RICH_BLOCK_BYTES,
	MAX_RICH_BLOCKS,
	type RichBlock,
	type RichBlockKind,
} from "@superagentteam/shared/types";
import type { ResponseDraftStore } from "../response/store.ts";
import { RICH_BLOCK_KINDS } from "./tool-surface.ts";

export type RichBlockErrorCode =
	| "rich_block_invalid"
	| "rich_block_too_large"
	| "rich_block_too_many"
	| "rich_block_approval_forbidden"
	| "rich_block_draft_missing";

export class RichBlockError extends Error {
	readonly code: RichBlockErrorCode;

	constructor(code: RichBlockErrorCode, message: string) {
		super(message);
		this.code = code;
		this.name = "RichBlockError";
	}
}

export interface RichBlockCreateResult {
	blockId: string;
	blockCount: number;
	maxBlocks: number;
}

export interface RichBlockServiceDeps {
	drafts: ResponseDraftStore;
	clock?: () => number;
}

function record(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new RichBlockError("rich_block_invalid", "block must be an object");
	}
	return value as Record<string, unknown>;
}

function nonEmpty(value: unknown): boolean {
	return typeof value === "string" && value.trim() !== "";
}

function nonEmptyArray(value: unknown): boolean {
	return Array.isArray(value) && value.length > 0;
}

/** Minimal per-kind shape checks; the renderer still degrades gracefully. */
const KIND_CHECKS: Record<RichBlockKind, (block: Record<string, unknown>) => boolean> = {
	card: (block) => nonEmpty(block.title) || nonEmpty(block.bodyMarkdown),
	diff: (block) => nonEmpty(block.diff),
	checklist: (block) => nonEmptyArray(block.items),
	media_gallery: (block) => nonEmptyArray(block.items),
	file: (block) => nonEmpty(block.fileName),
	audio: (block) => nonEmpty(block.url) || nonEmpty(block.text),
	html_widget: (block) => nonEmpty(block.html),
	interactive: (block) => nonEmptyArray(block.options),
};

export function validateRichBlock(value: unknown): RichBlock {
	const block = record(value);
	const id = block.id;
	if (typeof id !== "string" || id.length === 0 || id.length > 64) {
		throw new RichBlockError("rich_block_invalid", "block.id must be 1-64 characters");
	}
	if (block.v !== 1) throw new RichBlockError("rich_block_invalid", "block.v must be 1");
	const kind = block.kind;
	if (kind === "approval") {
		throw new RichBlockError("rich_block_approval_forbidden", "approval rich blocks are not allowed");
	}
	if (typeof kind !== "string" || !(RICH_BLOCK_KINDS as readonly string[]).includes(kind)) {
		throw new RichBlockError("rich_block_invalid", `unsupported rich block kind ${String(kind)}`);
	}
	if (Buffer.byteLength(JSON.stringify(block), "utf8") > MAX_RICH_BLOCK_BYTES) {
		throw new RichBlockError("rich_block_too_large", `block exceeds ${MAX_RICH_BLOCK_BYTES} bytes`);
	}
	const typedKind = kind as RichBlockKind;
	if (!KIND_CHECKS[typedKind](block)) {
		throw new RichBlockError("rich_block_invalid", `block is missing required fields for ${typedKind}`);
	}
	return block as RichBlock;
}

export class RichBlockService {
	private readonly drafts: ResponseDraftStore;
	private readonly clock: () => number;

	constructor(deps: RichBlockServiceDeps) {
		this.drafts = deps.drafts;
		this.clock = deps.clock ?? Date.now;
	}

	create(turnExecutionId: string, value: unknown): RichBlockCreateResult {
		const block = validateRichBlock(value);
		let blocks: RichBlock[] | null;
		try {
			blocks = this.drafts.upsertRichBlock(turnExecutionId, block, this.clock());
		} catch (error) {
			if (error instanceof Error && error.message === "rich_block_too_many") {
				throw new RichBlockError("rich_block_too_many", `a response may contain at most ${MAX_RICH_BLOCKS} blocks`);
			}
			throw error;
		}
		if (!blocks) {
			throw new RichBlockError("rich_block_draft_missing", "response draft is no longer open for rich blocks");
		}
		return { blockId: block.id, blockCount: blocks.length, maxBlocks: MAX_RICH_BLOCKS };
	}
}
