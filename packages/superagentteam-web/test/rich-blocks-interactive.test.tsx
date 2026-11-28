import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RichMessageExtra } from "@superagentteam/shared/types";
import { describe, expect, it, vi } from "vitest";

import { RichBlocks } from "@/components/chat/RichBlocks";

function extra(block: Record<string, unknown>): RichMessageExtra {
	return { v: 1, blocks: [block as RichMessageExtra["blocks"][number]] };
}

const selectBlock = {
	id: "choose",
	kind: "interactive",
	v: 1,
	interactiveType: "select",
	title: "选一个方案",
	options: [
		{ id: "a", label: "方案 A", description: "快速方案" },
		{ id: "b", label: "方案 B" },
	],
};

describe("F056 interactive rich blocks", () => {
	it("submits a select choice and locks after success", async () => {
		const onRespond = vi.fn().mockResolvedValue(undefined);
		render(<RichBlocks extra={extra(selectBlock)} messageId="msg:1" onRespond={onRespond} />);
		expect(screen.getByText("选一个方案")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: /方案 A/ }));
		expect(screen.getByRole("button", { name: /方案 A/ })).toHaveAttribute("aria-pressed", "true");
		fireEvent.click(screen.getByRole("button", { name: "确认选择" }));
		await waitFor(() =>
			expect(onRespond).toHaveBeenCalledWith("msg:1", "choose", { selectedIds: ["a"] }),
		);
		await waitFor(() => expect(screen.getByRole("button", { name: /方案 A/ })).toBeDisabled());
	});

	it("limits multi-select to maxSelect and submits the checked set", async () => {
		const onRespond = vi.fn().mockResolvedValue(undefined);
		const block = {
			id: "multi",
			kind: "interactive",
			v: 1,
			interactiveType: "multi-select",
			maxSelect: 2,
			options: [
				{ id: "a", label: "A" },
				{ id: "b", label: "B" },
				{ id: "c", label: "C" },
			],
		};
		render(<RichBlocks extra={extra(block)} messageId="msg:2" onRespond={onRespond} />);
		fireEvent.click(screen.getByRole("button", { name: "A" }));
		fireEvent.click(screen.getByRole("button", { name: "B" }));
		fireEvent.click(screen.getByRole("button", { name: "C" }));
		expect(screen.getByRole("button", { name: "C" })).toHaveAttribute("aria-pressed", "false");
		fireEvent.click(screen.getByRole("button", { name: "确认选择 (2)" }));
		await waitFor(() =>
			expect(onRespond).toHaveBeenCalledWith("msg:2", "multi", { selectedIds: ["a", "b"] }),
		);
	});

	it("requires custom input for options that accept it", async () => {
		const onRespond = vi.fn().mockResolvedValue(undefined);
		const block = {
			id: "custom",
			kind: "interactive",
			v: 1,
			interactiveType: "select",
			options: [
				{ id: "a", label: "固定方案" },
				{ id: "b", label: "自定义", customInput: true, customInputPlaceholder: "说说你的想法" },
			],
		};
		render(<RichBlocks extra={extra(block)} messageId="msg:3" onRespond={onRespond} />);
		fireEvent.click(screen.getByRole("button", { name: "自定义" }));
		const input = screen.getByLabelText("自定义输入");
		expect(screen.getByRole("button", { name: "确认选择" })).toBeDisabled();
		fireEvent.change(input, { target: { value: "第三条路" } });
		fireEvent.click(screen.getByRole("button", { name: "确认选择" }));
		await waitFor(() =>
			expect(onRespond).toHaveBeenCalledWith("msg:3", "custom", {
				selectedIds: ["b"],
				customInput: "第三条路",
			}),
		);
	});

	it("submits confirm/cancel immediately", async () => {
		const onRespond = vi.fn().mockResolvedValue(undefined);
		const block = {
			id: "confirm",
			kind: "interactive",
			v: 1,
			interactiveType: "confirm",
			title: "继续吗",
			options: [
				{ id: "yes", label: "继续" },
				{ id: "no", label: "取消" },
			],
		};
		render(<RichBlocks extra={extra(block)} messageId="msg:4" onRespond={onRespond} />);
		fireEvent.click(screen.getByRole("button", { name: "继续" }));
		await waitFor(() =>
			expect(onRespond).toHaveBeenCalledWith("msg:4", "confirm", { selectedIds: ["yes"] }),
		);
	});

	it("renders answered blocks disabled with the chosen option highlighted", () => {
		const onRespond = vi.fn();
		render(
			<RichBlocks
				extra={extra({ ...selectBlock, disabled: true, selectedIds: ["b"] })}
				messageId="msg:5"
				onRespond={onRespond}
			/>,
		);
		expect(screen.getByRole("button", { name: /方案 B/ })).toHaveAttribute("aria-pressed", "true");
		expect(screen.getByRole("button", { name: /方案 B/ })).toBeDisabled();
		expect(screen.getByText("已提交选择")).toBeInTheDocument();
	});

	it("shows a submit error and stays interactive", async () => {
		const onRespond = vi.fn().mockRejectedValue(new Error("队列已满"));
		render(<RichBlocks extra={extra(selectBlock)} messageId="msg:6" onRespond={onRespond} />);
		fireEvent.click(screen.getByRole("button", { name: /方案 A/ }));
		fireEvent.click(screen.getByRole("button", { name: "确认选择" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("队列已满");
		expect(screen.getByRole("button", { name: /方案 A/ })).not.toBeDisabled();
	});

	it("falls back to a read-only note without a handler", () => {
		render(<RichBlocks extra={extra(selectBlock)} messageId="msg:7" />);
		expect(screen.getByText("当前上下文不支持交互提交")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /方案 A/ })).toBeDisabled();
	});
});
