import type { AgentStreamEvent } from "@superagentteam/shared/types";
import { beforeEach, describe, expect, it } from "vitest";

import { createExecutionStore } from "@/domains/events/execution-store";

const threadId = "thread:1";
const turnExecutionId = "turn:1";

function event(overrides: Partial<AgentStreamEvent> = {}): AgentStreamEvent {
	return {
		type: "thinking",
		seq: 1,
		agentId: "a1",
		turnExecutionId,
		content: "",
		timestamp: 10,
		...overrides,
	} as AgentStreamEvent;
}

describe("execution store", () => {
	let store: ReturnType<typeof createExecutionStore>;

	beforeEach(() => {
		store = createExecutionStore();
		store.getState().begin(threadId);
	});

	it("merges thinking/text, dedupes seq, and pairs tool results by toolId", () => {
		store.getState().apply(threadId, event({ type: "thinking", seq: 1, content: "I ", timestamp: 10 }));
		store.getState().apply(threadId, event({ type: "thinking", seq: 1, content: "duplicate", timestamp: 11 }));
		store.getState().apply(threadId, event({ type: "thinking", seq: 2, content: "think", timestamp: 12 }));
		store.getState().apply(threadId, event({ type: "text", seq: 3, content: "answer", timestamp: 13 }));
		store.getState().apply(
			threadId,
			event({
				type: "tool_call",
				seq: 4,
				toolId: "tool:1",
				name: "Read",
				args: { path: "/tmp/a" },
				timestamp: 14,
			}),
		);
		store.getState().apply(
			threadId,
			event({
				type: "tool_result",
				seq: 5,
				toolId: "tool:1",
				name: "Read",
				result: { ok: true },
				timestamp: 20,
			}),
		);
		store.getState().apply(threadId, event({ type: "done", seq: 6, timestamp: 21 }));

		const turn = store.getState().turns[turnExecutionId]!;
		expect(turn.thinking).toBe("I think");
		expect(turn.text).toBe("answer");
		expect(turn.lastSeq).toBe(6);
		expect(turn.status).toBe("done");
		expect(turn.toolEvents).toEqual([
			{
				toolCallId: "tool:1",
				name: "Read",
				status: "completed",
				at: 14,
				endedAt: 20,
				args: { path: "/tmp/a" },
				result: { ok: true },
			},
		]);
	});

	it("creates a completed record for a result without a start and records errors", () => {
		store.getState().apply(
			threadId,
			event({
				type: "tool_result",
				seq: 1,
				toolId: "tool:2",
				name: "Bash",
				result: { isError: true },
				timestamp: 30,
			}),
		);
		store.getState().apply(threadId, event({ type: "error", seq: 2, error: "boom", timestamp: 31 }));

		const turn = store.getState().turns[turnExecutionId]!;
		expect(turn.toolEvents).toEqual([
			{
				toolCallId: "tool:2",
				name: "Bash",
				status: "completed",
				at: 30,
				endedAt: 30,
				result: { isError: true },
			},
		]);
		expect(turn.status).toBe("error");
		expect(turn.error).toBe("boom");
	});

	it("ignores other threads and resets on thread change", () => {
		store.getState().apply("thread:other", event({ seq: 1 }));
		expect(store.getState().turns[turnExecutionId]).toBeUndefined();

		store.getState().apply(threadId, event({ seq: 1 }));
		expect(store.getState().turns[turnExecutionId]).toBeDefined();
		store.getState().begin("thread:2");
		expect(store.getState().threadId).toBe("thread:2");
		expect(store.getState().turns).toEqual({});
	});
});
