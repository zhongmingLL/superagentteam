import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ObservabilityDialog } from "@/components/observability/ObservabilityDialog";
import type { TelemetryApi, TelemetrySpan } from "@/domains/telemetry/api";

function span(overrides: Partial<TelemetrySpan> = {}): TelemetrySpan {
	return {
		traceId: "a".repeat(32),
		spanId: "b".repeat(16),
		name: "superagentteam.turn",
		kind: "internal",
		startTimeMs: 1_000,
		endTimeMs: 1_042,
		durationMs: 42,
		status: { code: "ok" },
		attributes: {
			"thread.id": "hmac-thread",
			"agent.id": "hmac-agent",
			"turn.execution.id": "hmac-turn",
			provider: "mock",
			model: "a-model",
			"turn.status": "completed",
		},
		events: [{ name: "turn_terminal", timeMs: 1_042 }],
		storedAt: 1_042,
		droppedAttributes: 0,
		...overrides,
	};
}

function api(): Pick<TelemetryApi, "traces" | "metrics" | "logs" | "health"> {
	return {
		health: vi.fn(async () => ({
			status: "ready",
			daemon: { runningRevision: "test" },
			telemetry: {
				status: "ready" as const,
				trace: { status: "ready" as const, spanCount: 2, maxSpans: 10_000, maxAgeMs: 86_400_000 },
				metrics: { status: "ready" as const, seriesCount: 1 },
				logs: { status: "ready" as const, fileCount: 1 },
				otlp: { status: "disabled" as const },
			},
		})),
		traces: vi.fn(async () => ({
			availability: "available" as const,
			spans: [span(), span({ name: "superagentteam.queue.process", spanId: "c".repeat(16) })],
			truncated: false,
		})),
		metrics: vi.fn(async () => ({
			series: [
				{
					name: "superagentteam_turns_completed_total",
					kind: "counter" as const,
					labels: { provider: "mock", model: "a-model", status: "completed" },
					value: 1,
				},
			],
			readiness: { status: "ready" as const, seriesCount: 1 },
		})),
		logs: vi.fn(async () => ({
			availability: "available" as const,
			entries: [
				{
					ts: new Date(1_000).toISOString(),
					level: "info" as const,
					event: "test_event",
					fields: { thread_id: "thread:1", agent_id: "a1" },
				},
			],
			truncated: false,
			scannedFiles: 1,
		})),
	};
}

describe("observability dialog", () => {
	it("shows health, traces and span detail", async () => {
		const fake = api();
		render(<ObservabilityDialog threadId="thread:1" api={fake} onClose={() => {}} />);
		expect(await screen.findByText("Trace ring")).toBeInTheDocument();
		expect((await screen.findAllByText("superagentteam.turn")).length).toBeGreaterThan(0);
		expect(fake.traces).toHaveBeenCalledWith({ threadId: "thread:1", limit: 100 });
		expect(await screen.findByText("Attributes")).toBeInTheDocument();
		expect(screen.getAllByText("provider").length).toBeGreaterThan(0);
		expect(screen.getByText("turn_terminal")).toBeInTheDocument();
	});

	it("loads metrics and logs tabs", async () => {
		const fake = api();
		render(<ObservabilityDialog threadId="thread:1" api={fake} onClose={() => {}} />);
		await screen.findByText("Attributes");
		fireEvent.click(screen.getByRole("tab", { name: "Metrics" }));
		expect(await screen.findByText("superagentteam_turns_completed_total")).toBeInTheDocument();
		expect(fake.metrics).toHaveBeenCalledTimes(1);
		fireEvent.click(screen.getByRole("tab", { name: "Logs" }));
		expect(await screen.findByText("test_event")).toBeInTheDocument();
		expect(fake.logs).toHaveBeenCalledWith(100);
	});

	it("shows the trace-unavailable reason", async () => {
		const fake = api();
		fake.traces = vi.fn(async () => ({
			availability: "trace_unavailable" as const,
			reason: "telemetry_disabled" as const,
			spans: [],
			truncated: false,
		}));
		render(<ObservabilityDialog threadId="thread:1" api={fake} onClose={() => {}} />);
		expect(await screen.findByText(/telemetry 已关闭/)).toBeInTheDocument();
	});
});
