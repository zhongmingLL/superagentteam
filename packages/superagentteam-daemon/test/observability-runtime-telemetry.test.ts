import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createObservabilityRuntime } from "../src/observability/runtime.ts";
import { createRuntimeTelemetry, disabledRuntimeTelemetry } from "../src/observability/runtime-telemetry.ts";

const dirs: string[] = [];

function runtime(): ReturnType<typeof createObservabilityRuntime> {
	const dir = mkdtempSync(join(tmpdir(), "f055-telemetry-"));
	dirs.push(dir);
	return createObservabilityRuntime({ dataDir: dir, now: () => 1_000 });
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("F055 runtime telemetry facade", () => {
	it("starts thread-first spans, attaches tool children and exposes query/log/metrics", async () => {
		const obs = runtime();
		const telemetry = createRuntimeTelemetry(obs);
		const turn = telemetry.startSpan("superagentteam.turn", {
			"thread.id": "thread:1",
			"agent.id": "a1",
			"invocation.id": "inv:1",
			"turn.execution.id": "te:1",
			"attempt.id": "att:1",
			provider: "mock",
			model: "a-model",
		});
		expect(turn).not.toBeNull();
		telemetry.registerTurn("te:1", turn!.context);
		const tool = telemetry.startToolSpan("te:1", {
			"tool.name": "post_message",
			"tool.category": "a2a",
			"turn.execution.id": "te:1",
			"invocation.id": "inv:1",
		});
		expect(tool).not.toBeNull();
		expect(tool!.context.traceId).toBe(turn!.context.traceId);
		tool!.setStatus("ok");
		tool!.end();
		turn!.setStatus("ok");
		turn!.end();
		const storedTool = obs.traces
			.query({ traceId: turn!.context.traceId })
			.spans.find((span) => span.name === "superagentteam.tool");
		expect(storedTool?.parentSpanId).toBe(turn!.context.spanId);

		expect(obs.traces.query({ threadId: "thread:1" }).spans).toHaveLength(1);
		expect(obs.traces.query({ agentId: "a1" }).spans).toHaveLength(1);
		expect(obs.traces.query({ turnExecutionId: "te:1" }).spans).toHaveLength(2);

		telemetry.recordMessageAdmitted("conversation_input");
		telemetry.recordQueueDepth(3);
		telemetry.recordTurnStarted({ provider: "mock", model: "a-model" });
		telemetry.recordTurnFinished({ provider: "mock", model: "a-model", status: "completed" }, 42);
		telemetry.recordTool("post_message", "a2a", "ok");
		telemetry.recordSteer("guide", "guided");
		telemetry.recordSeal("manual");
		telemetry.recordError("turn", "provider_error");

		const snapshot = telemetry.metricsSnapshot();
		expect(snapshot).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "superagentteam_queue_depth", value: 3 }),
				expect.objectContaining({ name: "superagentteam_messages_admitted_total", value: 1 }),
				expect.objectContaining({ name: "superagentteam_turns_started_total", value: 1 }),
				expect.objectContaining({ name: "superagentteam_turns_completed_total", value: 1 }),
				expect.objectContaining({ name: "superagentteam_tool_calls_total", value: 1 }),
				expect.objectContaining({ name: "superagentteam_steer_total", value: 1 }),
				expect.objectContaining({ name: "superagentteam_session_seals_total", value: 1 }),
				expect.objectContaining({ name: "superagentteam_errors_total", value: 1 }),
			]),
		);

		obs.logs?.append("info", "test_event", { thread_id: "thread:1", agent_id: "a1" });
		const tail = telemetry.logsTail({ limit: 10 });
		expect(tail?.entries.some((entry) => entry.event === "test_event")).toBe(true);
		expect(telemetry.readiness().metrics.status).toBe("ready");
		await obs.close();
	});

	it("returns null spans and no metrics when telemetry is disabled", () => {
		const telemetry = disabledRuntimeTelemetry("test");
		expect(telemetry.startSpan("superagentteam.turn", {})).toBeNull();
		telemetry.recordTurnStarted({ provider: "mock", model: "a-model" });
		expect(telemetry.metricsSnapshot()).toEqual([]);
		expect(telemetry.logsTail()).toBeNull();
		expect(telemetry.readiness().status).toBe("disabled");
	});
});
