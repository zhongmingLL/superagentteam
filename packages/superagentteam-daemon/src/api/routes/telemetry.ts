import type { IncomingMessage, ServerResponse } from "node:http";

import type { A2ARuntime } from "../../app/a2a-runtime.ts";
import type { LogLevel } from "../../observability/contracts.ts";
import type { RuntimeTelemetry } from "../../observability/runtime-telemetry.ts";
import { sendError, sendJson } from "../http.ts";
import type { ApiRouteContext } from "./context.ts";

const TRACES_PATH = "/api/telemetry/traces";
const TRACE_STATS_PATH = "/api/telemetry/traces/stats";
const METRICS_PATH = "/api/telemetry/metrics";
const METRICS_PROM_PATH = "/api/telemetry/metrics/prometheus";
const LOGS_PATH = "/api/telemetry/logs";
const HEALTH_PATH = "/api/telemetry/health";

export interface TelemetryRoutes {
	handle(request: IncomingMessage, response: ServerResponse, url: URL, context: ApiRouteContext): Promise<boolean>;
}

export interface TelemetryRoutesOptions {
	telemetry: RuntimeTelemetry;
	runtime?: A2ARuntime;
	daemonHealth?: () => unknown;
}

function numberParam(value: string | null, min: number, max: number): number | undefined {
	if (value === null) return undefined;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < min || parsed > max) return undefined;
	return parsed;
}

function stringParam(value: string | null): string | undefined {
	return value === null || value.trim() === "" ? undefined : value;
}

export function createTelemetryRoutes(options: TelemetryRoutesOptions): TelemetryRoutes {
	const { telemetry, runtime } = options;

	function authorizedThread(threadId: string, userId: string, response: ServerResponse): boolean {
		if (!runtime) return true;
		const thread = runtime.threads.get(threadId);
		if (!thread || (thread.deletedAt !== null && thread.deletedAt !== undefined)) {
			sendError(response, 404, "thread_not_found", `thread ${threadId} not found`);
			return false;
		}
		if (thread.createdBy !== userId) {
			sendError(response, 403, "forbidden", `thread ${threadId} belongs to another user`);
			return false;
		}
		return true;
	}

	function authorizedSession(sessionId: string, userId: string, response: ServerResponse): boolean {
		if (!runtime) return true;
		const session = runtime.sessions.get(sessionId);
		if (!session) {
			sendError(response, 404, "session_not_found", `session ${sessionId} not found`);
			return false;
		}
		return authorizedThread(session.threadId, userId, response);
	}

	async function handle(
		request: IncomingMessage,
		response: ServerResponse,
		url: URL,
		context: ApiRouteContext,
	): Promise<boolean> {
		if (request.method !== "GET") return false;

		if (url.pathname === TRACES_PATH) {
			const threadId = stringParam(url.searchParams.get("threadId"));
			if (threadId && !authorizedThread(threadId, context.session.userId, response)) return true;
			const sessionId = stringParam(url.searchParams.get("sessionId"));
			if (sessionId && !authorizedSession(sessionId, context.session.userId, response)) return true;
			const limit = numberParam(url.searchParams.get("limit"), 1, 500);
			const startMin = numberParam(url.searchParams.get("startMin"), 0, Number.MAX_SAFE_INTEGER);
			const startMax = numberParam(url.searchParams.get("startMax"), 0, Number.MAX_SAFE_INTEGER);
			const result = telemetry.observability.traces.query({
				userId: context.session.userId,
				...(stringParam(url.searchParams.get("traceId"))
					? { traceId: stringParam(url.searchParams.get("traceId")) }
					: {}),
				...(stringParam(url.searchParams.get("invocationId"))
					? { invocationId: stringParam(url.searchParams.get("invocationId")) }
					: {}),
				...(threadId ? { threadId } : {}),
				...(stringParam(url.searchParams.get("agentId"))
					? { agentId: stringParam(url.searchParams.get("agentId")) }
					: {}),
				...(stringParam(url.searchParams.get("turnExecutionId"))
					? { turnExecutionId: stringParam(url.searchParams.get("turnExecutionId")) }
					: {}),
				...(stringParam(url.searchParams.get("queueEntryId"))
					? { queueEntryId: stringParam(url.searchParams.get("queueEntryId")) }
					: {}),
				...(sessionId ? { sessionId } : {}),
				...(stringParam(url.searchParams.get("name")) ? { name: stringParam(url.searchParams.get("name")) } : {}),
				...(limit ? { limit } : {}),
				...(startMin !== undefined ? { startMin } : {}),
				...(startMax !== undefined ? { startMax } : {}),
			});
			sendJson(response, 200, result);
			return true;
		}

		if (url.pathname === TRACE_STATS_PATH) {
			sendJson(response, 200, telemetry.observability.traces.stats());
			return true;
		}

		if (url.pathname === METRICS_PATH) {
			sendJson(response, 200, {
				series: telemetry.metricsSnapshot(),
				readiness: telemetry.readiness().metrics,
			});
			return true;
		}

		if (url.pathname === METRICS_PROM_PATH) {
			const readiness = telemetry.readiness().metrics;
			if (readiness.status !== "ready") {
				sendError(response, 503, "metrics_unavailable", readiness.reason ?? "metrics unavailable");
				return true;
			}
			response.writeHead(200, {
				"content-type": "text/plain; charset=utf-8",
				"cache-control": "no-store",
			});
			response.end(telemetry.observability.metrics.renderPrometheus());
			return true;
		}

		if (url.pathname === LOGS_PATH) {
			const limit = numberParam(url.searchParams.get("limit"), 1, 1000);
			const level = url.searchParams.get("level");
			const since = url.searchParams.get("since") ?? undefined;
			const allowedLevels: readonly string[] = ["debug", "info", "warn", "error"];
			if (level !== null && !allowedLevels.includes(level)) {
				sendError(response, 400, "invalid_input", "level must be debug|info|warn|error");
				return true;
			}
			if (since !== undefined && Number.isNaN(Date.parse(since))) {
				sendError(response, 400, "invalid_input", "since must be an ISO timestamp");
				return true;
			}
			const tail = telemetry.logsTail({
				...(limit ? { limit } : {}),
				...(level ? { level: level as LogLevel } : {}),
				...(since ? { since } : {}),
			});
			if (!tail) {
				sendJson(response, 200, { availability: "unavailable", entries: [], truncated: false, scannedFiles: 0 });
				return true;
			}
			sendJson(response, 200, { availability: "available", ...tail });
			return true;
		}

		if (url.pathname === HEALTH_PATH) {
			const readiness = telemetry.readiness();
			sendJson(response, 200, {
				status: readiness.status,
				daemon: options.daemonHealth?.() ?? null,
				telemetry: readiness,
			});
			return true;
		}

		return false;
	}

	return { handle };
}
