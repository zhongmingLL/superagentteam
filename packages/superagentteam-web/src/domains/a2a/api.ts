import { api } from "@/lib/api";
import type { ApiClient } from "@/lib/api/client.ts";

export interface QueueEntryView {
	queueEntryId: string;
	sourceRecordId: string;
	status: "queued" | "claimed";
	priority: "urgent" | "normal";
	position: number;
	targetAgentIds: string[];
	claimedBy: string | null;
	enqueuedAt: number;
	updatedAt: number;
}

export type LiveChildStatus = "running" | "completed" | "failed" | "interrupted" | "canceled";
export type LiveResponseStatus = "processing" | "completed" | "failed" | "interrupted" | "canceled" | "missing";

export interface LiveInvocationView {
	agentId: string;
	turnExecutionId: string;
	parentInvocationId: string | null;
	startedAt: number;
	childStatus: LiveChildStatus;
	responseStatus: LiveResponseStatus;
	evidenceRank: "record+tracker" | "tracker-only" | "record-only";
}

export interface QueueSnapshot {
	threadId: string;
	cap: { perKind: number };
	queue: QueueEntryView[];
	entries: QueueEntryView[];
	activeInvocations: LiveInvocationView[];
}

export interface LiveSnapshot {
	threadId: string;
	invocations: LiveInvocationView[];
}

export interface RetryInvocationReceipt {
	status: "retrying";
	retriedAgentIds: string[];
}

export interface CancelAgentReceipt {
	status: "canceling";
	agentId: string;
}

export type SteerMode = "guide" | "interrupt";

export interface SteerQueueReceipt {
	status: "guided" | "started" | "queued";
	mode: SteerMode;
	targetAgentId: string;
	disposition?: string;
	parentInvocationId?: string;
	dispatched?: string[];
	reason?: string;
}

export interface A2AApi {
	queue(threadId: string): Promise<QueueSnapshot>;
	live(threadId: string): Promise<LiveSnapshot>;
	retryInvocation(threadId: string, invocationId: string): Promise<RetryInvocationReceipt>;
	cancelAgent(threadId: string, agentId: string): Promise<CancelAgentReceipt>;
	steerQueue(
		threadId: string,
		queueEntryId: string,
		targetAgentId: string,
		mode: SteerMode,
	): Promise<SteerQueueReceipt>;
}

export function createA2AApi(client: Pick<ApiClient, "get" | "post">): A2AApi {
	return {
		queue: (threadId) => client.get<QueueSnapshot>(`/api/threads/${encodeURIComponent(threadId)}/queue`),
		live: (threadId) => client.get<LiveSnapshot>(`/api/threads/${encodeURIComponent(threadId)}/live`),
		retryInvocation: (threadId, invocationId) =>
			client.post<RetryInvocationReceipt>(
				`/api/threads/${encodeURIComponent(threadId)}/invocations/${encodeURIComponent(invocationId)}/retry`,
				{},
			),
		cancelAgent: (threadId, agentId) =>
			client.post<CancelAgentReceipt>(
				`/api/threads/${encodeURIComponent(threadId)}/agents/${encodeURIComponent(agentId)}/cancel`,
				{},
			),
		steerQueue: (threadId, queueEntryId, targetAgentId, mode) =>
			client.post<SteerQueueReceipt>(
				`/api/threads/${encodeURIComponent(threadId)}/queue/${encodeURIComponent(queueEntryId)}/steer`,
				{ targetAgentId, mode },
			),
	};
}

export const a2aApi = createA2AApi(api);
