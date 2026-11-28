import type { RichBlock } from "@superagentteam/shared/types";
import { describe, expect, it } from "vitest";

import {
	buildInteractiveResponseText,
	InteractiveResponseError,
	parseInteractiveBlock,
	validateInteractiveSelection,
} from "../src/domains/rich-blocks/interactive-response.ts";

function block(overrides: Record<string, unknown> = {}): RichBlock {
	return {
		id: "choose",
		kind: "interactive",
		v: 1,
		interactiveType: "select",
		title: "选一个方案",
		options: [
			{ id: "a", label: "方案 A", emoji: "🅰️", description: "快速方案" },
			{ id: "b", label: "方案 B" },
		],
		...overrides,
	} as RichBlock;
}

describe("F056 interactive response contract", () => {
	it("defaults missing interactiveType to select and parses options", () => {
		const parsed = parseInteractiveBlock(block({ interactiveType: undefined }));
		expect(parsed.interactiveType).toBe("select");
		expect(parsed.options.map((option) => option.id)).toEqual(["a", "b"]);
	});

	it("rejects unsupported types, empty options, duplicate ids and over-limit options", () => {
		expect(() => parseInteractiveBlock(block({ interactiveType: "dropdown" }))).toThrow(InteractiveResponseError);
		expect(() => parseInteractiveBlock(block({ options: [] }))).toThrow(InteractiveResponseError);
		expect(() =>
			parseInteractiveBlock(
				block({
					options: [
						{ id: "a", label: "A" },
						{ id: "a", label: "A again" },
					],
				}),
			),
		).toThrow(/unique/);
		expect(() =>
			parseInteractiveBlock(
				block({
					options: Array.from({ length: 13 }, (_, index) => ({ id: `o${index}`, label: `O${index}` })),
				}),
			),
		).toThrow(/at most 12/);
	});

	it("validates select/card-grid/confirm cardinality and multi-select bounds", () => {
		const select = parseInteractiveBlock(block());
		expect(validateInteractiveSelection(select, ["a"])).toEqual(["a"]);
		expect(() => validateInteractiveSelection(select, ["a", "b"])).toThrow(/exactly one/);
		expect(() => validateInteractiveSelection(select, ["nope"])).toThrow(/unknown option/);

		const multi = parseInteractiveBlock(block({ interactiveType: "multi-select", maxSelect: 2 }));
		expect(validateInteractiveSelection(multi, ["b", "a", "a"])).toEqual(["b", "a"]);
		expect(() => validateInteractiveSelection(multi, ["a", "b", "a"])).not.toThrow();
		expect(() =>
			validateInteractiveSelection(
				parseInteractiveBlock(
					block({
						interactiveType: "multi-select",
						maxSelect: 1,
					}),
				),
				["a", "b"],
			),
		).toThrow(/at most 1/);

		const confirm = parseInteractiveBlock(block({ interactiveType: "confirm" }));
		expect(() => validateInteractiveSelection(confirm, ["a", "b"])).toThrow(/exactly one/);
	});

	it("builds default selection text with emoji and title", () => {
		const parsed = parseInteractiveBlock(block());
		expect(buildInteractiveResponseText(parsed, ["a"])).toBe("我选了：🅰️ 方案 A（选一个方案）");
		expect(buildInteractiveResponseText(parsed, ["a", "b"])).toContain("方案 A, 方案 B");
	});

	it("honours messageTemplate {selection}", () => {
		const parsed = parseInteractiveBlock(block({ messageTemplate: "开始执行 {selection}，谢谢" }));
		expect(buildInteractiveResponseText(parsed, ["b"])).toBe("开始执行 方案 B，谢谢（选一个方案）");
	});

	it("appends custom input only for options that accept it", () => {
		const parsed = parseInteractiveBlock(
			block({
				options: [
					{ id: "a", label: "方案 A", customInput: true },
					{ id: "b", label: "方案 B" },
				],
			}),
		);
		expect(buildInteractiveResponseText(parsed, ["a"], "  就这样  ")).toBe("方案 A：就这样（选一个方案）");
		expect(() => buildInteractiveResponseText(parsed, ["b"], "不行")).toThrow(/does not accept custom input/);
		expect(() => buildInteractiveResponseText(parsed, ["a"], "x".repeat(501))).toThrow(/exceeds 500/);
	});

	it("builds confirm/cancel text from canonical sentinels or first two options", () => {
		const confirm = parseInteractiveBlock(block({ interactiveType: "confirm" }));
		expect(buildInteractiveResponseText(confirm, ["a"])).toBe("确认 — 选一个方案");
		expect(buildInteractiveResponseText(confirm, ["b"])).toBe("取消 — 选一个方案");

		const sentinel = parseInteractiveBlock(
			block({
				interactiveType: "confirm",
				options: [
					{ id: "__confirm__", label: "就这么办" },
					{ id: "__cancel__", label: "再想想" },
				],
			}),
		);
		expect(buildInteractiveResponseText(sentinel, ["__confirm__"])).toBe("确认 — 选一个方案");
		expect(buildInteractiveResponseText(sentinel, ["__cancel__"])).toBe("取消 — 选一个方案");
		expect(() => buildInteractiveResponseText(sentinel, ["a"])).toThrow(/confirm or cancel/);
	});
});
