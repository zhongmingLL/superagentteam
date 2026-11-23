import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MessageList } from "@/components/chat/MessageList";
import type { MessageView } from "@/domains/chat/api";
import type { ThreadView } from "@/domains/thread/api";

const thread: ThreadView = {
	id: "thread:1",
	projectPath: "/tmp/project",
	title: "Alpha",
	titleSource: "user",
	createdBy: "operator:1",
	participants: ["agent:1"],
	lastActiveAt: 1,
	createdAt: 1,
	updatedAt: 1,
	deletedAt: null,
};

function message(overrides: Partial<MessageView> = {}): MessageView {
	return {
		id: "msg:1",
		threadId: "thread:1",
		type: "user",
		from: { kind: "user", userId: "operator:1" },
		content: "hello",
		timestamp: 1,
		updatedAt: 1,
		...overrides,
	};
}

function renderList(overrides: Partial<React.ComponentProps<typeof MessageList>> = {}) {
	return render(
		<MessageList
			thread={thread}
			messages={[message()]}
			status="ready"
			hasMore={false}
			loadingOlder={false}
			followingLatest
			pendingUserMessages={[]}
			onLoadOlder={() => {}}
			onRetry={() => {}}
			onResumeLatest={() => {}}
			{...overrides}
		/>,
	);
}

describe("message list", () => {
	it("renders the execution record above the final answer", () => {
		renderList({
			messages: [
				message({
					type: "assistant",
					from: { kind: "agent", agentId: "agent:1" },
					content: "final answer",
					thinking: "check first",
					toolEvents: [
						{
							toolCallId: "tool:1",
							name: "Read",
							status: "completed",
							at: 1,
							endedAt: 2,
							result: { ok: true },
						},
					],
				}),
			],
		});

		const record = screen.getByTestId("message-execution-record");
		const answer = screen.getByText("final answer");
		expect(record.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it("renders message text without interpreting HTML", () => {
		const { container } = renderList({
			messages: [message({ content: '<script>alert("x")</script>' })],
		});

		expect(screen.getByText('<script>alert("x")</script>')).toBeInTheDocument();
		expect(container.querySelector("script")).toBeNull();
	});

	it("renders fenced code blocks as text inside pre/code", () => {
		const { container } = renderList({
			messages: [message({ content: "before\n```ts\nconst x = 1;\n```\nafter" })],
		});

		expect(screen.getByText("before")).toBeInTheDocument();
		expect(screen.getByText("const x = 1;")).toBeInTheDocument();
		expect(container.querySelector("pre code")).toHaveTextContent("const x = 1;");
	});

	it("shows a processing placeholder for an in-flight response", () => {
		renderList({
			messages: [
				message({
					id: "msg:processing",
					type: "assistant",
					from: { kind: "agent", agentId: "agent:1" },
					content: "",
					lifecycle: {
						kind: "response",
						parentInvocationId: "inv:1",
						turnExecutionId: "turn:1",
						target: { kind: "agent", id: "agent:1" },
						status: "processing",
						startedAt: 1,
					},
				}),
			],
		});

		expect(screen.getByText("正在回复…")).toBeInTheDocument();
	});

	it("shows receipt-backed sends as pending, not as history", () => {
		renderList({
			messages: [],
			pendingUserMessages: [{ messageId: "msg:sent", content: "new message" }],
		});

		expect(screen.getByText("new message")).toBeInTheDocument();
		expect(screen.getByText("发送中…")).toBeInTheDocument();
	});

	it("shows a live placeholder when an agent accepted a turn but has not produced a response message", () => {
		renderList({
			messages: [],
			liveInvocations: [
				{
					agentId: "a1",
					turnExecutionId: "turn:1",
					parentInvocationId: "inv:1",
					startedAt: Date.now() - 60_000,
					childStatus: "running",
					responseStatus: "missing",
					evidenceRank: "record+tracker",
				},
			],
			agentLabel: (agentId) => (agentId === "a1" ? "Agent A1" : agentId),
		});

		expect(screen.getByText("Agent A1")).toBeInTheDocument();
		expect(screen.getByText("已受理")).toBeInTheDocument();
		expect(screen.getByText(/正在处理/)).toBeInTheDocument();
	});

	it("shows a visible terminal state when a response failed without content", () => {
		renderList({
			messages: [
				message({
					id: "msg:failed",
					type: "assistant",
					from: { kind: "agent", agentId: "a1" },
					content: "",
					lifecycle: {
						kind: "response",
						parentInvocationId: "inv:1",
						turnExecutionId: "turn:1",
						target: { kind: "agent", id: "a1" },
						status: "failed",
						startedAt: 1,
						endedAt: 2,
					},
				}),
			],
		});

		expect(screen.getByText("回复失败")).toBeInTheDocument();
	});

	it("retries a failed response through the invocation id", async () => {
		const onRetryInvocation = vi.fn(async () => {});
		renderList({
			messages: [
				message({
					id: "msg:failed",
					type: "assistant",
					from: { kind: "agent", agentId: "a1" },
					content: "",
					lifecycle: {
						kind: "response",
						parentInvocationId: "inv:1",
						turnExecutionId: "turn:1",
						target: { kind: "agent", id: "a1" },
						status: "failed",
						startedAt: 1,
						endedAt: 2,
					},
				}),
			],
			onRetryInvocation,
		});

		fireEvent.click(screen.getByRole("button", { name: "重试" }));

		await waitFor(() => expect(onRetryInvocation).toHaveBeenCalledWith("inv:1"));
		expect(await screen.findByText("已重新排队")).toBeInTheDocument();
	});

	it("shows a typed retry failure and keeps the action available", async () => {
		renderList({
			messages: [
				message({
					id: "msg:failed",
					type: "assistant",
					from: { kind: "agent", agentId: "a1" },
					content: "",
					lifecycle: {
						kind: "response",
						parentInvocationId: "inv:1",
						turnExecutionId: "turn:1",
						target: { kind: "agent", id: "a1" },
						status: "failed",
						startedAt: 1,
						endedAt: 2,
					},
				}),
			],
			onRetryInvocation: vi.fn(async () => Promise.reject(new Error("这条回复当前不能重试"))),
		});

		fireEvent.click(screen.getByRole("button", { name: "重试" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("这条回复当前不能重试");
		expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
	});

	it("hides retry while the parent invocation is live", () => {
		renderList({
			messages: [
				message({
					id: "msg:failed",
					type: "assistant",
					from: { kind: "agent", agentId: "a1" },
					content: "",
					lifecycle: {
						kind: "response",
						parentInvocationId: "inv:1",
						turnExecutionId: "turn:1",
						target: { kind: "agent", id: "a1" },
						status: "failed",
						startedAt: 1,
						endedAt: 2,
					},
				}),
			],
			liveInvocations: [
				{
					agentId: "a1",
					turnExecutionId: "turn:2",
					parentInvocationId: "inv:1",
					startedAt: Date.now(),
					childStatus: "running",
					responseStatus: "missing",
					evidenceRank: "tracker-only",
				},
			],
			onRetryInvocation: vi.fn(async () => {}),
		});

		expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
	});

	it("labels agent messages with the display name", () => {
		renderList({
			messages: [
				message({
					id: "msg:agent",
					type: "assistant",
					from: { kind: "agent", agentId: "a1" },
					content: "hello from a1",
				}),
			],
			agentLabel: (agentId) => (agentId === "a1" ? "Agent A1" : agentId),
		});
		expect(screen.getByText("Agent A1")).toBeInTheDocument();
		expect(screen.queryByText("a1")).not.toBeInTheDocument();
	});

	it("shows cross-thread provenance and opens the source thread", () => {
		const onOpenThread = vi.fn();
		renderList({
			messages: [
				message({
					id: "msg:cross",
					type: "assistant",
					from: { kind: "agent", agentId: "a1" },
					content: "cross posted",
					extra: { crossPost: { sourceThreadId: "thread:0" } },
				}),
			],
			threadLabel: (threadId) => (threadId === "thread:0" ? "Source thread" : threadId),
			onOpenThread,
		});
		expect(screen.getByText("跨线程来自")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Source thread" }));
		expect(onOpenThread).toHaveBeenCalledWith("thread:0");
	});

	it("marks multi-mention aggregates and operator mentions", () => {
		renderList({
			messages: [
				message({
					id: "msg:multi",
					type: "system",
					from: { kind: "system", service: "multi_mention" },
					content: "aggregate",
					extra: { multiMention: { status: "done", targetAgentIds: ["a1", "a2"] } },
					mentionsUser: true,
				}),
			],
		});
		expect(screen.getByText("multi-mention · done · 2 targets")).toBeInTheDocument();
		expect(screen.getByText("提到了你")).toBeInTheDocument();
	});

	it("renders agent messages as nameplates and keeps user messages as bubbles", () => {
		const { container } = renderList({
			messages: [
				message({ id: "msg:agent", type: "assistant", from: { kind: "agent", agentId: "a1" }, content: "short" }),
				message({ id: "msg:user", content: "hi" }),
			],
		});
		const agent = container.querySelector('article[data-message-id="msg:agent"]');
		const user = container.querySelector('article[data-message-id="msg:user"]');
		expect(agent?.className).toContain("is-nameplate");
		expect(user?.className).not.toContain("is-nameplate");
	});

	it("shows A2A recipients and dispatch phase on agent input messages", () => {
		renderList({
			messages: [
				message({
					id: "msg:a2a",
					type: "assistant",
					from: { kind: "agent", agentId: "a1" },
					content: "Agent B: please answer",
					extra: { targetAgentIds: ["a2"] },
					lifecycle: {
						kind: "input",
						dispatchRefs: [
							{
								target: { kind: "agent", id: "a2" },
								queueEntryId: "q:1",
								attempt: 1,
								phase: "settled",
								at: 2,
							},
						],
					},
				}),
			],
			agentLabel: (agentId) => (agentId === "a2" ? "Agent B" : agentId),
		});
		const dispatch = screen.getByTestId("message-dispatch-targets");
		expect(dispatch).toHaveTextContent("发送给");
		expect(dispatch).toHaveTextContent("Agent B");
		expect(dispatch).toHaveTextContent("已回复");
	});

	it("renders rich blocks and a visible fallback for unknown kinds", () => {
		const { container } = renderList({
			messages: [
				message({
					id: "msg:rich",
					type: "assistant",
					from: { kind: "agent", agentId: "a1" },
					content: "see below",
					extra: {
						rich: {
							v: 1,
							blocks: [
								{
									id: "b1",
									v: 1,
									kind: "card",
									title: "Status",
									bodyMarkdown: '<script>alert("x")</script>',
									tone: "success",
									fields: [{ label: "CI", value: "5/5" }],
								},
								{ id: "b2", v: 1, kind: "checklist", items: [{ id: "i1", text: "done", checked: true }] },
								{ id: "b3", v: 1, kind: "diff", filePath: "a.ts", diff: "@@ -1 +1 @@\n-old\n+new" },
								{ id: "b4", v: 1, kind: "mystery" as never },
							],
						},
					},
				}),
			],
		});
		expect(screen.getByText("Status")).toBeInTheDocument();
		expect(screen.getByText('<script>alert("x")</script>')).toBeInTheDocument();
		expect(container.querySelector(".st-rich-card script")).toBeNull();
		expect(screen.getByText("done")).toBeInTheDocument();
		expect(container.querySelector(".st-diff-line.is-del")).toHaveTextContent("-old");
		expect(container.querySelector(".st-diff-line.is-add")).toHaveTextContent("+new");
		expect(screen.getByText(/无法展示 mystery/)).toBeInTheDocument();
	});
});
