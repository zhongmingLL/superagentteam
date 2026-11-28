import { api } from "@/lib/api";
import type { ApiClient } from "@/lib/api/client.ts";

// F055: the observability contracts live in the daemon; the web mirrors the
// JSON projection instead of importing daemon code.
export type TelemetryLogLevel = "debug" | "info" | "warn" | "error";
export type TelemetryAttributeValue = string | number | boolean;
export type TelemetryAttributes = Readonly<Record<string, TelemetryAttributeValue>>;

export interface TelemetrySpanEvent {
	name: string;
	timeMs: number;
	attributes?: TelemetryAttributes;
}

export interface TelemetrySpan {
	traceId: string;
	spanId: string;
	parentSpanId?: string;
	name: string;
	kind: "internal" | "server" | "client";
	startTimeMs: number;
	endTimeMs: number;
	durationMs: number;
	status: { code: "unset" | "ok" | "error"; message?: string };
	attributes: TelemetryAttributes;
	events: TelemetrySpanEvent[];
	storedAt: number;
	droppedAttributes: number;
}

export interface MetricSeries {
	name: string;
	kind: "counter" | "gauge" | "histogram";
	labels: Readonly<Record<string, string | number | boolean>>;
	value?: number;
	buckets?: readonly number[];
	counts?: readonly number[];
	sum?: number;
	count?: number;
}

export interface TelemetryReadiness {
	status: "ready" | "degraded" | "disabled";
	reason?: string;
	trace: {
		status: "ready" | "degraded" | "disabled";
		spanCount: number;
		maxSpans: number;
		maxAgeMs: number;
		reason?: string;
	};
	metrics: { status: "ready" | "degraded" | "disabled"; seriesCount: number; reason?: string };
	logs: { status: "ready" | "degraded" | "disabled"; fileCount: number; reason?: string };
	otlp: { status: "disabled" | "enabled" | "degraded"; reason?: string };
}

export interface TraceResponse {
	availability: "available" | "trace_unavailable";
	reason?: "ring_miss" | "telemetry_disabled";
	spans: TelemetrySpan[];
	truncated: boolean;
}

export interface TraceStats {
	spanCount: number;
	maxSpans: number;
	maxAgeMs: number;
	oldestStoredAt: number | null;
	newestStoredAt: number | null;
}

export interface MetricsResponse {
	series: MetricSeries[];
	readiness: TelemetryReadiness["metrics"];
}

export interface LogEntryView {
	ts: string;
	level: TelemetryLogLevel;
	event: string;
	fields: Record<string, unknown>;
}

export interface LogsResponse {
	availability: "available" | "unavailable";
	entries: LogEntryView[];
	truncated: boolean;
	scannedFiles: number;
}

export interface TelemetryHealthResponse {
	status: string;
	daemon: Record<string, unknown> | null;
	telemetry: TelemetryReadiness;
}

export interface TelemetryApi {
	traces(query: {
		threadId?: string;
		agentId?: string;
		invocationId?: string;
		turnExecutionId?: string;
		queueEntryId?: string;
		sessionId?: string;
		name?: string;
		limit?: number;
	}): Promise<TraceResponse>;
	stats(): Promise<TraceStats>;
	metrics(): Promise<MetricsResponse>;
	logs(limit?: number): Promise<LogsResponse>;
	health(): Promise<TelemetryHealthResponse>;
}

function queryString(values: Record<string, string | number | undefined>): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined || value === "") continue;
		params.set(key, String(value));
	}
	const text = params.toString();
	return text === "" ? "" : `?${text}`;
}

export function createTelemetryApi(client: Pick<ApiClient, "get">): TelemetryApi {
	return {
		traces: (query) =>
			client.get<TraceResponse>(
				`/api/telemetry/traces${queryString({
					threadId: query.threadId,
					agentId: query.agentId,
					invocationId: query.invocationId,
					turnExecutionId: query.turnExecutionId,
					queueEntryId: query.queueEntryId,
					sessionId: query.sessionId,
					name: query.name,
					limit: query.limit,
				})}`,
			),
		stats: () => client.get<TraceStats>("/api/telemetry/traces/stats"),
		metrics: () => client.get<MetricsResponse>("/api/telemetry/metrics"),
		logs: (limit = 100) => client.get<LogsResponse>(`/api/telemetry/logs?limit=${limit}`),
		health: () => client.get<TelemetryHealthResponse>("/api/telemetry/health"),
	};
}

export const telemetryApi = createTelemetryApi(api);
