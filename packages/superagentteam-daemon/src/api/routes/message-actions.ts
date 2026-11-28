import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { A2ARuntime } from "../../app/a2a-runtime.ts";
import {
	buildInteractiveResponseText,
	InteractiveResponseError,
	parseInteractiveBlock,
	validateInteractiveSelection,
} from "../../domains/rich-blocks/interactive-response.ts";
import type { ChangeBus } from "../../infrastructure/events/bus.ts";
import { HttpError, readJsonBody, sendError, sendJson } from "../http.ts";
import { requireCsrf } from "../session.ts";
import type { ApiRouteContext } from "./context.ts";

const RESPOND_PATH = /^\/api\/messages\/([^/]+)\/rich-blocks\/([^/]+)\/respond$/;

export interface MessageActionRoutes {
	handle(request: IncomingMessage, response: ServerResponse, url: URL, context: ApiRouteContext): Promise<boolean>;
}

export interface MessageActionRoutesOptions {
	runtime: A2ARuntime;
	changeBus?: ChangeBus;
	clock?: () => number;
}

function fail(response: ServerResponse, status: number, code: string, message: string): true {
	sendError(response, status, code, message);
	return true;
}

function decodePathPart(value: string): string | null {
	try {
		const decoded = decodeURIComponent(value);
		return decoded.trim() === "" ? null : decoded;
	} catch {
		return null;
	}
}

/** F056: one deterministic id per (message, block, selection, custom text). */
export function richBlockResponseMessageId(
	threadId: string,
	messageId: string,
	blockId: string,
	selectedIds: string[],
	customInput?: string,
): string {
	const digest = createHash("sha256")
		.update(
			`${threadId}\u0000rich-block\u0000${messageId}\u0000${blockId}\u0000${selectedIds.join("\u0000")}\u0000${customInput ?? ""}`,
		)
		.digest("hex")
		.slice(0, 32);
	return `msg:${digest}`;
}

export function createMessageActionRoutes(options: MessageActionRoutesOptions): MessageActionRoutes {
	const clock = options.clock ?? Date.now;
	const { runtime } = options;

	async function respond(
		request: IncomingMessage,
		response: ServerResponse,
		url: URL,
		context: ApiRouteContext,
	): Promise<boolean> {
		const match = RESPOND_PATH.exec(url.pathname);
		if (!match) return false;
		const messageId = decodePathPart(match[1]!);
		const blockId = decodePathPart(match[2]!);
		if (!messageId || !blockId) return fail(response, 400, "invalid_input", "invalid message or block id");

		const csrf = request.headers["x-csrf-token"];
		const csrfToken = Array.isArray(csrf) ? csrf[0] : csrf;
		if (!requireCsrf(context.session, csrfToken)) return fail(response, 403, "csrf_failed", "invalid CSRF token");

		let body: unknown;
		try {
			body = await readJsonBody(request);
		} catch (error) {
			if (error instanceof HttpError) return fail(response, error.status, error.code, error.message);
			throw error;
		}
		if (body === undefined || typeof body !== "object" || body === null || Array.isArray(body)) {
			return fail(response, 400, "invalid_input", "request body must be a JSON object");
		}
		const input = body as Record<string, unknown>;
		if (input.customInput !== undefined && typeof input.customInput !== "string") {
			return fail(response, 400, "invalid_input", "customInput must be a string");
		}
		const customInput = typeof input.customInput === "string" ? input.customInput : undefined;

		const message = runtime.messages.get(messageId);
		if (!message) return fail(response, 404, "message_not_found", `message ${messageId} not found`);
		const thread = runtime.threads.get(message.threadId);
		if (!thread) return fail(response, 404, "thread_not_found", `thread ${message.threadId} not found`);
		if (thread.createdBy !== context.session.userId) {
			return fail(response, 403, "forbidden", "message belongs to another user's thread");
		}
		const block = message.extra?.rich?.blocks?.find((item) => item.id === blockId);
		if (!block) return fail(response, 404, "block_not_found", `block ${blockId} not found`);

		let parsed: ReturnType<typeof parseInteractiveBlock>;
		let selectedIds: string[];
		let content: string;
		try {
			if (block.kind !== "interactive") {
				throw new InteractiveResponseError("interactive_invalid", `block ${blockId} is not interactive`);
			}
			parsed = parseInteractiveBlock(block);
			if (parsed.disabled) {
				return fail(response, 409, "block_disabled", "this interactive block has already been answered");
			}
			selectedIds = validateInteractiveSelection(parsed, input.selectedIds);
			content = buildInteractiveResponseText(parsed, selectedIds, customInput);
		} catch (error) {
			if (error instanceof InteractiveResponseError) {
				return fail(response, 422, error.code, error.message);
			}
			throw error;
		}

		const span = runtime.telemetry.startSpan("superagentteam.rich_block.respond", {
			"thread.id": message.threadId,
			"user.id": context.session.userId,
			"message.id": message.id,
			"block.id": blockId,
			"interactive.type": parsed.interactiveType,
		});
		try {
			const deterministicId = richBlockResponseMessageId(
				message.threadId,
				message.id,
				blockId,
				selectedIds,
				customInput,
			);
			const now = clock();
			let result: ReturnType<A2ARuntime["ingress"]["submit"]>;
			try {
				result = runtime.ingress.submit({
					threadId: message.threadId,
					userId: context.session.userId,
					body: content,
					messageId: deterministicId,
					now,
				});
			} catch (error) {
				const text = error instanceof Error ? error.message : String(error);
				if (text.startsWith("ingress_replay_entry_missing") || text.startsWith("ingress_message_id_conflict")) {
					return fail(response, 409, "already_responded", "this selection was already submitted");
				}
				if (text.startsWith("queue_full")) return fail(response, 429, "queue_full", "thread queue is full");
				if (text.startsWith("thread_deleted")) return fail(response, 409, "thread_deleted", "thread is deleted");
				if (text.startsWith("thread_project_path_required")) {
					return fail(
						response,
						422,
						"thread_project_path_required",
						"thread projectPath is required before dispatching",
					);
				}
				if (
					text.startsWith("no_target") ||
					text.startsWith("agent_not_found") ||
					text.startsWith("agent_disabled") ||
					text.startsWith("account_not_found")
				) {
					return fail(response, 422, "target_invalid", text);
				}
				if (text.startsWith("body_too_large")) {
					return fail(response, 413, "payload_too_large", "message body is too large");
				}
				throw error;
			}
			span?.setAttribute("target.count", result.targetAgentIds.length);
			span?.setAttribute("queue.entry.id", result.queueEntry.queueEntryId);

			const updated = runtime.messages.updateRichBlockState(
				message.id,
				blockId,
				{ disabled: true, selectedIds },
				now,
			);
			options.changeBus?.publish(message.threadId, ["messages", "queue", "thread"], now);
			span?.setStatus("ok");
			sendJson(response, 202, {
				status: "queued",
				userMessageId: result.message.id,
				entryId: result.queueEntry.queueEntryId,
				queuePosition: result.queueEntry.position,
				targetAgentIds: result.targetAgentIds,
				block: { id: blockId, disabled: true, selectedIds },
				blockState: updated.outcome === "updated" ? "persisted" : "stale",
			});
			return true;
		} catch (error) {
			span?.setStatus("error", "rich_block_respond_failed");
			throw error;
		} finally {
			span?.end();
		}
	}

	async function handle(
		request: IncomingMessage,
		response: ServerResponse,
		url: URL,
		context: ApiRouteContext,
	): Promise<boolean> {
		if (request.method !== "POST") return false;
		return respond(request, response, url, context);
	}

	return { handle };
}
