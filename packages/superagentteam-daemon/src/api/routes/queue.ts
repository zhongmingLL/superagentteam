import type { IncomingMessage, ServerResponse } from "node:http";

import type { QueueEntry } from "@superagentteam/shared/types";

import type { A2ARuntime } from "../../app/a2a-runtime.ts";
import { getThreadLiveInvocations, type LiveInvocationView } from "../../domains/invocation/read-models/live.ts";
import { QUEUE_CAP_PER_KIND } from "../../domains/queue/ledger/store.ts";
import type { ChangeBus } from "../../infrastructure/events/bus.ts";
import { HttpError, readJsonBody, sendError, sendJson } from "../http.ts";
import { requireCsrf } from "../session.ts";
import type { ApiRouteContext } from "./context.ts";

const QUEUE_PATH = /^\/api\/threads\/([^/]+)\/queue$/;
const QUEUE_STEER_PATH = /^\/api\/threads\/([^/]+)\/queue\/([^/]+)\/steer$/;

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

export interface QueueRoutes {
	handle(request: IncomingMessage, response: ServerResponse, url: URL, context: ApiRouteContext): Promise<boolean>;
}

export interface QueueRoutesOptions {
	runtime: A2ARuntime;
	changeBus?: ChangeBus;
}

function toView(entry: QueueEntry): QueueEntryView {
	return {
		queueEntryId: entry.queueEntryId,
		sourceRecordId: entry.payload.sourceRecordId,
		status: entry.status,
		priority: entry.priority,
		position: entry.position,
		targetAgentIds: entry.targets.filter((target) => target.kind === "agent").map((target) => target.id),
		claimedBy: entry.claim?.owner ?? null,
		enqueuedAt: entry.enqueuedAt,
		updatedAt: entry.updatedAt,
	};
}

function order(left: QueueEntryView, right: QueueEntryView): number {
	const urgency = (left.priority === "urgent" ? 0 : 1) - (right.priority === "urgent" ? 0 : 1);
	if (urgency !== 0) return urgency;
	return left.position - right.position || left.queueEntryId.localeCompare(right.queueEntryId);
}

export function createQueueRoutes(options: QueueRoutesOptions): QueueRoutes {
	const { runtime } = options;

	function live(threadId: string): LiveInvocationView[] {
		return getThreadLiveInvocations(
			{ tracker: runtime.tracker, turns: runtime.turns, attempts: runtime.attempts, messages: runtime.messages },
			threadId,
		);
	}

	function decode(value: string): string | null {
		try {
			return decodeURIComponent(value);
		} catch {
			return null;
		}
	}

	function authorizedThread(threadId: string, context: ApiRouteContext, response: ServerResponse): boolean {
		const thread = runtime.threads.get(threadId);
		if (!thread || (thread.deletedAt !== null && thread.deletedAt !== undefined)) {
			sendError(response, 404, "thread_not_found", `thread ${threadId} not found`);
			return false;
		}
		if (thread.createdBy !== context.session.userId) {
			sendError(response, 403, "forbidden", `thread ${threadId} belongs to another user`);
			return false;
		}
		return true;
	}

	async function steer(
		request: IncomingMessage,
		response: ServerResponse,
		threadId: string,
		queueEntryId: string,
		context: ApiRouteContext,
	): Promise<void> {
		const csrf = request.headers["x-csrf-token"];
		const csrfToken = Array.isArray(csrf) ? csrf[0] : csrf;
		if (!requireCsrf(context.session, csrfToken)) {
			sendError(response, 403, "csrf_failed", "invalid CSRF token");
			return;
		}
		if (!authorizedThread(threadId, context, response)) return;

		let body: unknown;
		try {
			body = await readJsonBody(request);
		} catch (error) {
			if (error instanceof HttpError) {
				sendError(response, error.status, error.code, error.message);
				return;
			}
			sendError(response, 400, "invalid_input", "request body is not readable");
			return;
		}
		if (!body || typeof body !== "object") {
			sendError(response, 400, "invalid_input", "body must be an object");
			return;
		}
		const candidate = body as Record<string, unknown>;
		const targetAgentId = candidate.targetAgentId;
		const mode = candidate.mode;
		if (
			typeof targetAgentId !== "string" ||
			targetAgentId.length === 0 ||
			(mode !== "guide" && mode !== "interrupt")
		) {
			sendError(response, 400, "invalid_input", "targetAgentId and mode=guide|interrupt are required");
			return;
		}

		const result = await runtime.steer.steer({
			threadId,
			queueEntryId,
			targetAgentId,
			mode,
			userId: context.session.userId,
		});
		if (result.outcome === "rejected") {
			const status =
				result.code === "thread_not_found" || result.code === "entry_not_found"
					? 404
					: result.code === "forbidden"
						? 403
						: result.code === "steer_failed"
							? 502
							: result.code === "not_startable"
								? 422
								: 409;
			sendError(response, status, result.code, result.message);
			return;
		}
		options.changeBus?.publish(threadId, ["queue", "live"]);
		sendJson(response, 202, { status: result.outcome, mode, ...result });
	}

	async function handle(
		request: IncomingMessage,
		response: ServerResponse,
		url: URL,
		context: ApiRouteContext,
	): Promise<boolean> {
		if (request.method === "POST") {
			const match = QUEUE_STEER_PATH.exec(url.pathname);
			if (!match) return false;
			const threadId = decode(match[1]!);
			const queueEntryId = decode(match[2]!);
			if (!threadId || !queueEntryId) {
				sendError(response, 400, "invalid_input", "thread/queue id is not valid URL encoding");
				return true;
			}
			await steer(request, response, threadId, queueEntryId, context);
			return true;
		}
		if (request.method !== "GET") return false;
		const match = QUEUE_PATH.exec(url.pathname);
		if (!match) return false;
		const threadId = decode(match[1]!);
		if (!threadId) {
			sendError(response, 400, "invalid_input", "thread id is not valid URL encoding");
			return true;
		}
		if (!authorizedThread(threadId, context, response)) return true;
		const entries = [...runtime.queue.listQueued(threadId), ...runtime.queue.listActive(threadId)]
			.filter((entry) => entry.targets.some((target) => target.kind === "agent"))
			.map(toView)
			.sort(order);
		const activeInvocations = live(threadId);
		sendJson(response, 200, {
			threadId,
			cap: { perKind: QUEUE_CAP_PER_KIND },
			queue: entries,
			entries,
			activeInvocations,
		});
		return true;
	}

	return { handle };
}
