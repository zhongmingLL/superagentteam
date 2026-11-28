import type { IncomingMessage, ServerResponse } from "node:http";

import type { A2ARuntime } from "../../app/a2a-runtime.ts";
import type { SessionSealErrorCode } from "../../domains/sessions/seal-service.ts";
import type { ChangeBus } from "../../infrastructure/events/bus.ts";
import { HttpError, readJsonBody, sendError, sendJson } from "../http.ts";
import { requireCsrf } from "../session.ts";
import type { ApiRouteContext } from "./context.ts";

const CHAIN_PATH = /^\/api\/threads\/([^/]+)\/sessions$/;
const DETAIL_PATH = /^\/api\/sessions\/([^/]+)$/;
const TRANSCRIPT_PATH = /^\/api\/sessions\/([^/]+)\/transcript$/;
const SEAL_PATH = /^\/api\/sessions\/([^/]+)\/seal$/;

export interface SessionRoutes {
	handle(request: IncomingMessage, response: ServerResponse, url: URL, context: ApiRouteContext): Promise<boolean>;
}

export interface SessionRoutesOptions {
	runtime: A2ARuntime;
	changeBus?: ChangeBus;
}

function decode(value: string): string | null {
	try {
		return decodeURIComponent(value);
	} catch {
		return null;
	}
}

const STATUS: Record<SessionSealErrorCode, number> = {
	thread_not_found: 404,
	forbidden: 403,
	session_not_found: 404,
	session_not_active: 409,
	session_active_invocation: 409,
	session_busy: 409,
	session_artifact_exists: 409,
	session_artifact_not_found: 404,
	session_seal_conflict: 409,
};

export function createSessionRoutes(options: SessionRoutesOptions): SessionRoutes {
	const { runtime } = options;

	async function seal(
		request: IncomingMessage,
		response: ServerResponse,
		sessionId: string,
		context: ApiRouteContext,
	): Promise<void> {
		const csrf = request.headers["x-csrf-token"];
		const csrfToken = Array.isArray(csrf) ? csrf[0] : csrf;
		if (!requireCsrf(context.session, csrfToken)) {
			sendError(response, 403, "csrf_failed", "invalid CSRF token");
			return;
		}
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
		if (body !== undefined && (typeof body !== "object" || body === null)) {
			sendError(response, 400, "invalid_input", "body must be an object");
			return;
		}
		const reason =
			body && typeof (body as Record<string, unknown>).reason === "string"
				? ((body as Record<string, unknown>).reason as string)
				: "manual";
		let result: ReturnType<A2ARuntime["sessionSeal"]["seal"]>;
		try {
			result = runtime.sessionSeal.seal(sessionId, context.session.userId, reason);
		} catch {
			sendError(response, 500, "session_seal_failed", "session seal failed");
			return;
		}
		if (result.outcome === "rejected") {
			sendError(response, STATUS[result.code], result.code, result.message);
			return;
		}
		options.changeBus?.publish(result.session.threadId, ["thread", "live"]);
		sendJson(response, 200, { session: result.session, artifact: result.artifact });
	}

	async function handle(
		request: IncomingMessage,
		response: ServerResponse,
		url: URL,
		context: ApiRouteContext,
	): Promise<boolean> {
		if (request.method === "POST") {
			const match = SEAL_PATH.exec(url.pathname);
			if (!match) return false;
			const sessionId = decode(match[1]!);
			if (!sessionId) {
				sendError(response, 400, "invalid_input", "session id is not valid URL encoding");
				return true;
			}
			await seal(request, response, sessionId, context);
			return true;
		}
		if (request.method !== "GET") return false;

		const chainMatch = CHAIN_PATH.exec(url.pathname);
		if (chainMatch) {
			const threadId = decode(chainMatch[1]!);
			if (!threadId) {
				sendError(response, 400, "invalid_input", "thread id is not valid URL encoding");
				return true;
			}
			const agentId = url.searchParams.get("agentId") ?? undefined;
			const result = runtime.sessionSeal.chain(threadId, context.session.userId, agentId ?? undefined);
			if ("outcome" in result) {
				sendError(response, STATUS[result.code], result.code, result.message);
				return true;
			}
			sendJson(response, 200, result);
			return true;
		}

		const transcriptMatch = TRANSCRIPT_PATH.exec(url.pathname);
		if (transcriptMatch) {
			const sessionId = decode(transcriptMatch[1]!);
			if (!sessionId) {
				sendError(response, 400, "invalid_input", "session id is not valid URL encoding");
				return true;
			}
			const result = runtime.sessionSeal.transcript(sessionId, context.session.userId);
			if ("outcome" in result) {
				sendError(response, STATUS[result.code], result.code, result.message);
				return true;
			}
			sendJson(response, 200, result);
			return true;
		}

		const detailMatch = DETAIL_PATH.exec(url.pathname);
		if (detailMatch) {
			const sessionId = decode(detailMatch[1]!);
			if (!sessionId) {
				sendError(response, 400, "invalid_input", "session id is not valid URL encoding");
				return true;
			}
			const result = runtime.sessionSeal.detail(sessionId, context.session.userId);
			if ("outcome" in result) {
				sendError(response, STATUS[result.code], result.code, result.message);
				return true;
			}
			sendJson(response, 200, result);
			return true;
		}
		return false;
	}

	return { handle };
}
