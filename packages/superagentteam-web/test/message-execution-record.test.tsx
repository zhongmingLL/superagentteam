import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MessageExecutionRecord } from "@/components/chat/MessageExecutionRecord";
import type { LiveExecutionState } from "@/domains/events/execution-store";

const completedTool = {
	toolCallId: "tool:1",
	name: "Read",
	status: "completed" as const,
	at: 1_000,
	endedAt: 2_500,
	args: { path: "/tmp/a" },
	result: { ok: true },
};

function live(overrides: Partial<LiveExecutionState> = {}): LiveExecutionState {
	return {
		threadId: "thread:1",
		turnExecutionId: "turn:1",
		agentId: "a1",
		thinking: "checking",
		text: "",
		toolEvents: [],
		status: "running",
		lastSeq: 1,
		startedAt: 1,
		updatedAt: 2,
		...overrides,
	};
}

describe("message execution record", () => {
	it("renders collapsed thinking and tool record from history, then expands both", () => {
		const thinking = "We should check the file first and then read the surrounding code before editing. ".repeat(3);
		render(<MessageExecutionRecord thinking={thinking} toolEvents={[completedTool]} state="terminal" />);

		expect(screen.getByText("Thinking")).toBeInTheDocument();
		expect(screen.getByText(/We should check/)).toBeInTheDocument();
		expect(screen.getByTestId("message-execution-record").querySelector(".st-thinking-body")).toBeNull();

		fireEvent.click(screen.getByTestId("execution-thinking"));
		expect(screen.getByTestId("message-execution-record").querySelector(".st-thinking-body")).toHaveTextContent(
			thinking.trim(),
		);

		const tools = screen.getByTestId("execution-tools");
		expect(tools).toHaveTextContent("1 次工具调用");
		fireEvent.click(tools);
		const row = screen.getByTestId("execution-tool-tool:1");
		expect(within(row).getByText("Read")).toBeInTheDocument();
		fireEvent.click(within(row).getByRole("button", { name: /Read/ }));
		expect(screen.getByText(/\/tmp\/a/)).toBeInTheDocument();
	});

	it("auto-opens tools while live and shows the active tool", () => {
		render(
			<MessageExecutionRecord
				live={live({
					toolEvents: [{ ...completedTool, at: Date.now() - 500, status: "running", endedAt: undefined }],
				})}
				state="processing"
			/>,
		);

		expect(screen.getByTestId("execution-tools")).toHaveTextContent("正在调用 Read");
		expect(screen.getByTestId("execution-tool-tool:1")).toBeInTheDocument();
		expect(screen.getAllByLabelText("运行中").length).toBeGreaterThan(0);
	});

	it("shows an error state and an empty record renders nothing", () => {
		const { container } = render(
			<MessageExecutionRecord live={live({ status: "error", error: "provider failed" })} state="processing" />,
		);
		expect(screen.getByText("执行记录 · 失败")).toBeInTheDocument();
		expect(screen.getByText("provider failed")).toBeInTheDocument();

		const empty = render(<MessageExecutionRecord state="terminal" />);
		expect(empty.container).toBeEmptyDOMElement();
		container.remove();
	});
});
