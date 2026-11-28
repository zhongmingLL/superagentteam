import type { LogTailQuery, LogTailResult, MetricSeriesSnapshot, TelemetryReadiness } from "./contracts.ts";
import type { MetricLabels } from "./metrics.ts";
import { disabledObservabilityRuntime, type ObservabilityRuntime } from "./runtime.ts";
import type { SpanContext, SpanHandle } from "./tracer.ts";

// F055: thread-first facade over the local-first observability runtime.
//
// All methods are best-effort: a telemetry failure must never block the A2A
// control plane. A disabled runtime returns null spans and no-op metrics.

export interface TurnTelemetryLabels {
	provider: string;
	model: string;
	status?: string;
}

export interface RuntimeTelemetry {
	readonly enabled: boolean;
	readonly observability: ObservabilityRuntime;
	startSpan(name: string, attributes: Record<string, unknown>, parent?: SpanContext): SpanHandle | null;
	registerTurn(turnExecutionId: string, context: SpanContext): () => void;
	startToolSpan(turnExecutionId: string, attributes: Record<string, unknown>): SpanHandle | null;
	recordMessageAdmitted(kind: string): void;
	recordQueueDepth(depth: number): void;
	recordQueueProcessed(status: string): void;
	recordTurnStarted(labels: TurnTelemetryLabels): void;
	recordTurnFinished(labels: TurnTelemetryLabels, durationMs: number): void;
	recordTool(toolName: string, category: string, status: string): void;
	recordSteer(mode: string, status: string): void;
	recordSeal(reason: string): void;
	recordError(phase: string, kind: string): void;
	metricsSnapshot(): MetricSeriesSnapshot[];
	logsTail(query?: LogTailQuery): LogTailResult | null;
	readiness(): TelemetryReadiness;
}

class LocalRuntimeTelemetry implements RuntimeTelemetry {
	readonly observability: ObservabilityRuntime;
	readonly enabled: boolean;
	private readonly turnSpans = new Map<string, SpanContext>();

	constructor(observability: ObservabilityRuntime) {
		this.observability = observability;
		this.enabled = observability.status !== "disabled";
	}

	startSpan(name: string, attributes: Record<string, unknown>, parent?: SpanContext): SpanHandle | null {
		if (!this.enabled) return null;
		try {
			return this.observability.tracer.startSpan({ name, attributes, ...(parent ? { parent } : {}) });
		} catch {
			return null;
		}
	}

	registerTurn(turnExecutionId: string, context: SpanContext): () => void {
		if (!this.enabled) return () => {};
		this.turnSpans.set(turnExecutionId, context);
		return () => {
			if (this.turnSpans.get(turnExecutionId) === context) this.turnSpans.delete(turnExecutionId);
		};
	}

	startToolSpan(turnExecutionId: string, attributes: Record<string, unknown>): SpanHandle | null {
		const parent = this.turnSpans.get(turnExecutionId);
		return this.startSpan("superagentteam.tool", attributes, parent);
	}

	recordMessageAdmitted(kind: string): void {
		this.counter("superagentteam_messages_admitted_total", { "queue.kind": kind });
	}

	recordQueueDepth(depth: number): void {
		this.gauge("superagentteam_queue_depth", depth);
	}

	recordQueueProcessed(status: string): void {
		this.counter("superagentteam_queue_processed_total", { status });
	}

	recordTurnStarted(labels: TurnTelemetryLabels): void {
		this.counter("superagentteam_turns_started_total", this.turnLabels(labels));
	}

	recordTurnFinished(labels: TurnTelemetryLabels, durationMs: number): void {
		const bounded = this.turnLabels(labels);
		this.counter("superagentteam_turns_completed_total", bounded);
		this.histogram("superagentteam_turn_duration_ms", bounded, durationMs);
	}

	recordTool(toolName: string, category: string, status: string): void {
		this.counter("superagentteam_tool_calls_total", {
			"tool.name": toolName,
			"tool.category": category,
			status,
		});
	}

	recordSteer(mode: string, status: string): void {
		this.counter("superagentteam_steer_total", { "steer.mode": mode, status });
	}

	recordSeal(reason: string): void {
		this.counter("superagentteam_session_seals_total", { "seal.reason": reason });
	}

	recordError(phase: string, kind: string): void {
		this.counter("superagentteam_errors_total", { phase, "error.kind": kind });
	}

	metricsSnapshot(): MetricSeriesSnapshot[] {
		if (!this.enabled) return [];
		return this.observability.metrics.snapshot();
	}

	logsTail(query?: LogTailQuery): LogTailResult | null {
		return this.observability.logs?.tail(query) ?? null;
	}

	readiness(): TelemetryReadiness {
		return this.observability.readiness();
	}

	private turnLabels(labels: TurnTelemetryLabels): MetricLabels {
		return {
			provider: labels.provider,
			model: labels.model,
			...(labels.status ? { status: labels.status } : {}),
		};
	}

	private counter(name: string, labels: MetricLabels): void {
		if (!this.enabled) return;
		try {
			this.observability.metrics.counter(name, labels).add(1);
		} catch {
			// best-effort
		}
	}

	private gauge(name: string, value: number): void {
		if (!this.enabled) return;
		try {
			this.observability.metrics.gauge(name).set(value);
		} catch {
			// best-effort
		}
	}

	private histogram(name: string, labels: MetricLabels, value: number): void {
		if (!this.enabled) return;
		try {
			this.observability.metrics.histogram(name, labels).observe(value);
		} catch {
			// best-effort
		}
	}
}

export function createRuntimeTelemetry(observability: ObservabilityRuntime): RuntimeTelemetry {
	return new LocalRuntimeTelemetry(observability);
}

export function disabledRuntimeTelemetry(reason = "telemetry_disabled"): RuntimeTelemetry {
	return new LocalRuntimeTelemetry(disabledObservabilityRuntime(reason));
}
