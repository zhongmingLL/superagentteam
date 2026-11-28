import {
	type InteractiveOption,
	type InteractiveType,
	MAX_INTERACTIVE_CUSTOM_INPUT,
	MAX_INTERACTIVE_OPTIONS,
	type RichBlock,
} from "@superagentteam/shared/types";

// F056: interactive block response contract. Pure functions shared by the API
// route and tests; the stored block stays the open RichBlock shape.

export type InteractiveResponseErrorCode =
	| "interactive_invalid"
	| "interactive_unsupported"
	| "selection_invalid"
	| "custom_input_too_large"
	| "response_text_too_large";

export class InteractiveResponseError extends Error {
	readonly code: InteractiveResponseErrorCode;

	constructor(code: InteractiveResponseErrorCode, message: string) {
		super(message);
		this.code = code;
		this.name = "InteractiveResponseError";
	}
}

export interface ParsedInteractiveBlock {
	interactiveType: InteractiveType;
	title?: string;
	options: InteractiveOption[];
	maxSelect?: number;
	messageTemplate?: string;
	disabled: boolean;
	selectedIds: string[];
}

const INTERACTIVE_TYPES: readonly InteractiveType[] = ["select", "multi-select", "card-grid", "confirm"];
const MAX_RESPONSE_TEXT = 4_000;

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function parseOption(value: unknown): InteractiveOption {
	const option = record(value);
	const id = text(option?.id);
	const label = text(option?.label);
	if (!option || !id || !label) {
		throw new InteractiveResponseError("interactive_invalid", "interactive options require id and label");
	}
	return {
		id,
		label,
		...(text(option.emoji) ? { emoji: text(option.emoji)! } : {}),
		...(text(option.description) ? { description: text(option.description)! } : {}),
		...(text(option.group) ? { group: text(option.group)! } : {}),
		...(option.customInput === true ? { customInput: true } : {}),
		...(text(option.customInputPlaceholder) ? { customInputPlaceholder: text(option.customInputPlaceholder)! } : {}),
	};
}

export function parseInteractiveBlock(block: RichBlock): ParsedInteractiveBlock {
	const raw = block as Record<string, unknown>;
	const rawType = raw.interactiveType;
	const interactiveType = rawType === undefined ? "select" : rawType;
	if (typeof interactiveType !== "string" || !(INTERACTIVE_TYPES as readonly string[]).includes(interactiveType)) {
		throw new InteractiveResponseError(
			"interactive_unsupported",
			`unsupported interactiveType ${String(interactiveType)}`,
		);
	}
	const rawOptions = raw.options;
	if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
		throw new InteractiveResponseError("interactive_invalid", "interactive block requires options");
	}
	if (rawOptions.length > MAX_INTERACTIVE_OPTIONS) {
		throw new InteractiveResponseError(
			"interactive_invalid",
			`interactive block supports at most ${MAX_INTERACTIVE_OPTIONS} options`,
		);
	}
	const options = rawOptions.map(parseOption);
	if (new Set(options.map((option) => option.id)).size !== options.length) {
		throw new InteractiveResponseError("interactive_invalid", "interactive option ids must be unique");
	}
	const rawMax = raw.maxSelect;
	const maxSelect =
		typeof rawMax === "number" && Number.isInteger(rawMax) && rawMax > 0
			? Math.min(rawMax, options.length)
			: undefined;
	const rawSelected = raw.selectedIds;
	const selectedIds =
		Array.isArray(rawSelected) && rawSelected.every((id) => typeof id === "string") ? (rawSelected as string[]) : [];
	return {
		interactiveType: interactiveType as InteractiveType,
		...(text(raw.title) ? { title: text(raw.title)! } : {}),
		options,
		...(maxSelect !== undefined ? { maxSelect } : {}),
		...(text(raw.messageTemplate) ? { messageTemplate: text(raw.messageTemplate)! } : {}),
		disabled: raw.disabled === true,
		selectedIds,
	};
}

/** Normalize and validate selected ids against the block's declared options. */
export function validateInteractiveSelection(block: ParsedInteractiveBlock, value: unknown): string[] {
	if (!Array.isArray(value) || value.length === 0 || !value.every((id) => typeof id === "string")) {
		throw new InteractiveResponseError("selection_invalid", "selectedIds must be a non-empty string array");
	}
	const selected: string[] = [];
	for (const id of value as string[]) {
		if (!block.options.some((option) => option.id === id)) {
			throw new InteractiveResponseError("selection_invalid", `unknown option id ${id}`);
		}
		if (!selected.includes(id)) selected.push(id);
	}
	if (block.maxSelect !== undefined && selected.length > block.maxSelect) {
		throw new InteractiveResponseError("selection_invalid", `select at most ${block.maxSelect} options`);
	}
	switch (block.interactiveType) {
		case "select":
		case "card-grid":
		case "confirm":
			if (selected.length !== 1) {
				throw new InteractiveResponseError(
					"selection_invalid",
					`${block.interactiveType} requires exactly one selected option`,
				);
			}
			break;
		case "multi-select":
			break;
	}
	return selected;
}

function confirmPair(block: ParsedInteractiveBlock): { confirm: InteractiveOption; cancel: InteractiveOption } {
	const confirm = block.options.find((option) => option.id === "__confirm__") ?? block.options[0]!;
	const cancel = block.options.find((option) => option.id === "__cancel__") ??
		block.options.find((option) => option.id !== confirm.id) ?? {
			id: "__cancel__",
			label: "取消",
		};
	return { confirm, cancel };
}

function labelOf(option: InteractiveOption): string {
	return option.emoji ? `${option.emoji} ${option.label}` : option.label;
}

/** Deterministic selection text; mirrors Clowder F096 semantics. */
export function buildInteractiveResponseText(
	block: ParsedInteractiveBlock,
	selectedIds: string[],
	customInput?: string,
): string {
	const trimmedCustom = customInput?.trim();
	if (trimmedCustom && trimmedCustom.length > MAX_INTERACTIVE_CUSTOM_INPUT) {
		throw new InteractiveResponseError(
			"custom_input_too_large",
			`customInput exceeds ${MAX_INTERACTIVE_CUSTOM_INPUT} characters`,
		);
	}
	if (trimmedCustom && !block.options.some((option) => selectedIds.includes(option.id) && option.customInput)) {
		throw new InteractiveResponseError("selection_invalid", "selected option does not accept custom input");
	}
	const selected = selectedIds.map((id) => block.options.find((option) => option.id === id)!);
	let result: string;
	if (block.interactiveType === "confirm") {
		const { confirm, cancel } = confirmPair(block);
		const selectedId = selectedIds[0];
		if (selectedId !== confirm.id && selectedId !== cancel.id) {
			throw new InteractiveResponseError(
				"selection_invalid",
				"confirm selection must be the confirm or cancel option",
			);
		}
		const action = selectedId === confirm.id ? "确认" : "取消";
		result = block.title ? `${action} — ${block.title}` : action;
	} else {
		const labels = selected.map(labelOf);
		const selectionText = labels.join(", ");
		if (trimmedCustom) {
			result = labels.length > 0 ? `${selectionText}：${trimmedCustom}` : trimmedCustom;
		} else if (block.messageTemplate?.includes("{selection}")) {
			result = block.messageTemplate.split("{selection}").join(selectionText);
		} else {
			result = `我选了：${selectionText}`;
		}
		if (block.title) result = `${result}（${block.title}）`;
	}
	if (result.length > MAX_RESPONSE_TEXT) {
		throw new InteractiveResponseError(
			"response_text_too_large",
			`generated response exceeds ${MAX_RESPONSE_TEXT} characters`,
		);
	}
	return result;
}
