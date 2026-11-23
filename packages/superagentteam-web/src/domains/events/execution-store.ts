import type { AgentStreamEvent, StoredToolEvent } from "@superagentteam/shared/types";
import { create } from "zustand";

export type LiveExecutionStatus = "running" | "done" | "error";

export interface LiveExecutionState {
	threadId: string;
	turnExecutionId: string;
	agentId: string;
	thinking: string;
	text: string;
	toolEvents: StoredToolEvent[];
	status: LiveExecutionStatus;
	error?: string;
	lastSeq: number;
	startedAt: number;
	updatedAt: number;
}

export type LiveExecutionMap = Record<string, LiveExecutionState>;

export interface ExecutionStoreState {
	threadId: string | null;
	turns: LiveExecutionMap;
	begin(threadId: string): void;
	apply(threadId: string, event: AgentStreamEvent): void;
	reset(): void;
}

const MAX_LIVE_TURNS = 20;

function mergeToolCall(
	events: StoredToolEvent[],
	event: Extract<AgentStreamEvent, { type: "tool_call" }>,
): StoredToolEvent[] {
	const existing = events.find((entry) => entry.toolCallId === event.toolId);
	if (existing) {
		return events.map((entry) =>
			entry.toolCallId === event.toolId
				? {
						...entry,
						name: event.name,
						args: event.args,
						status: entry.status === "completed" ? "completed" : "running",
					}
				: entry,
		);
	}
	return [
		...events,
		{
			toolCallId: event.toolId,
			name: event.name,
			status: "running",
			at: event.timestamp,
			args: event.args,
		},
	];
}

function mergeToolResult(
	events: StoredToolEvent[],
	event: Extract<AgentStreamEvent, { type: "tool_result" }>,
): StoredToolEvent[] {
	const existing = events.find((entry) => entry.toolCallId === event.toolId);
	if (existing) {
		return events.map((entry) =>
			entry.toolCallId === event.toolId
				? { ...entry, name: event.name, status: "completed", endedAt: event.timestamp, result: event.result }
				: entry,
		);
	}
	return [
		...events,
		{
			toolCallId: event.toolId,
			name: event.name,
			status: "completed",
			at: event.timestamp,
			endedAt: event.timestamp,
			result: event.result,
		},
	];
}

function prune(turns: LiveExecutionMap): LiveExecutionMap {
	const entries = Object.entries(turns);
	if (entries.length <= MAX_LIVE_TURNS) return turns;
	entries.sort(([, left], [, right]) => right.updatedAt - left.updatedAt);
	return Object.fromEntries(entries.slice(0, MAX_LIVE_TURNS));
}

export function createExecutionStore() {
	return create<ExecutionStoreState>((set, get) => ({
		threadId: null,
		turns: {},

		begin(threadId) {
			if (get().threadId === threadId) return;
			set({ threadId, turns: {} });
		},

		apply(threadId, event) {
			const state = get();
			if (state.threadId !== threadId) return;
			const current = state.turns[event.turnExecutionId];
			if (current && event.seq <= current.lastSeq) return;
			const base: LiveExecutionState = current ?? {
				threadId,
				turnExecutionId: event.turnExecutionId,
				agentId: event.agentId,
				thinking: "",
				text: "",
				toolEvents: [],
				status: "running",
				lastSeq: 0,
				startedAt: event.timestamp,
				updatedAt: event.timestamp,
			};
			const next: LiveExecutionState = {
				...base,
				agentId: event.agentId,
				lastSeq: event.seq,
				updatedAt: event.timestamp,
			};
			switch (event.type) {
				case "thinking":
					next.thinking += event.content;
					break;
				case "text":
					next.text += event.content;
					break;
				case "tool_call":
					next.toolEvents = mergeToolCall(next.toolEvents, event);
					break;
				case "tool_result":
					next.toolEvents = mergeToolResult(next.toolEvents, event);
					break;
				case "done":
					next.status = "done";
					break;
				case "error":
					next.status = "error";
					next.error = event.error;
					break;
			}
			set((previous) => ({
				turns: prune({ ...previous.turns, [event.turnExecutionId]: next }),
			}));
		},

		reset() {
			set({ threadId: null, turns: {} });
		},
	}));
}

export const useExecutionStore = createExecutionStore();
