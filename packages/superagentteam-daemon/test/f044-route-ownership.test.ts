import { describe, expect, it } from "vitest";
import { AgentRouter, type AgentTurnResult, type TurnContext } from "../src/domains/agent/route.ts";
import type { HistoryWindow } from "../src/domains/history/assembler.ts";
import type { PreparedDispatch } from "../src/domains/queue/processor.ts";

const EMPTY_WINDOW: HistoryWindow = { mode: "bootstrap", rows: [], boundarySeq: 0 };

function target(agentId: string): PreparedDispatch {
	return {
		agentId,
		turnExecutionId: `te:${agentId}`,
		responseMessageId: `resp:${agentId}`,
	} as unknown as PreparedDispatch;
}

function result(agentId: string, responseText = `out:${agentId}`): AgentTurnResult {
	return {
		agentId,
		turnExecutionId: `te:${agentId}`,
		responseMessageId: `resp:${agentId}`,
		status: "completed",
		responseText,
	};
}

function completion(agentId: string, responseText?: string) {
	return { result: result(agentId, responseText), release: async () => {} };
}

function context(agentId: string, prompt = `prompt:${agentId}`): TurnContext {
	return { window: EMPTY_WINDOW, prompt };
}

describe("F044 AgentRouter route ownership", () => {
	it("routeParallel assembles every target context before starting any invocation", async () => {
		const events: string[] = [];
		const router = new AgentRouter({
			assemble: (prepared) => {
				events.push(`assemble:${prepared.agentId}`);
				return context(prepared.agentId);
			},
			runner: {
				async run({ prepared }) {
					events.push(`run:${prepared.agentId}`);
					return completion(prepared.agentId);
				},
			},
			committer: {
				commit(committed) {
					events.push(`commit:${committed.agentId}`);
				},
			},
		});

		const routed = await router.routeAgents([target("a1"), target("a2")], "parallel");

		expect(routed.errors).toEqual([]);
		expect(routed.results.map((item) => item.agentId)).toEqual(["a1", "a2"]);
		expect(events.slice(0, 2)).toEqual(["assemble:a1", "assemble:a2"]);
		expect(events.indexOf("run:a1")).toBeGreaterThan(events.indexOf("assemble:a2"));
		expect(events.indexOf("run:a2")).toBeGreaterThan(events.indexOf("assemble:a2"));
		expect(events.filter((event) => event.startsWith("commit:")).sort()).toEqual(["commit:a1", "commit:a2"]);
	});

	it("routeParallel isolates a failing target and still commits the healthy sibling", async () => {
		const committed: string[] = [];
		const router = new AgentRouter({
			assemble: (prepared) => context(prepared.agentId),
			runner: {
				async run({ prepared }) {
					if (prepared.agentId === "a1") throw new Error("provider_boom");
					return completion(prepared.agentId);
				},
			},
			committer: {
				commit(committedResult) {
					committed.push(committedResult.agentId);
				},
			},
		});

		const routed = await router.routeAgents([target("a1"), target("a2")], "parallel");

		expect(routed.results.map((item) => item.agentId)).toEqual(["a2"]);
		expect(routed.errors.map((item) => item.agentId)).toEqual(["a1"]);
		expect(String(routed.errors[0]!.error)).toContain("provider_boom");
		expect(committed).toEqual(["a2"]);
	});

	it("routeSerial runs single-target hops through assembly, commit, and cleanup", async () => {
		const events: string[] = [];
		const router = new AgentRouter({
			assemble: (prepared) => {
				events.push(`assemble:${prepared.agentId}`);
				return context(prepared.agentId);
			},
			runner: {
				async run({ prepared }) {
					events.push(`run:${prepared.agentId}`);
					return completion(prepared.agentId);
				},
			},
			committer: {
				commit(committedResult) {
					events.push(`commit:${committedResult.agentId}`);
				},
			},
		});

		const routed = await router.routeAgents([target("a1")], "serial");

		expect(routed.mode).toBe("serial");
		expect(routed.results).toHaveLength(1);
		expect(events).toEqual(["assemble:a1", "run:a1", "commit:a1"]);
	});

	it("routeSerial commits each response before the next target assembles its context", async () => {
		const events: string[] = [];
		const priorSeen: string[][] = [];
		const router = new AgentRouter({
			assemble: (prepared, priorResponses) => {
				priorSeen.push(priorResponses.map((prior) => prior.agentId));
				events.push(`assemble:${prepared.agentId}`);
				return context(prepared.agentId);
			},
			runner: {
				async run({ prepared }) {
					events.push(`run:${prepared.agentId}`);
					return completion(prepared.agentId, `${prepared.agentId}-response`);
				},
			},
			committer: {
				commit(committedResult) {
					events.push(`commit:${committedResult.agentId}`);
				},
			},
		});

		const routed = await router.routeAgents([target("a1"), target("a2")], "serial");

		expect(routed.results.map((item) => item.agentId)).toEqual(["a1", "a2"]);
		expect(priorSeen).toEqual([[], ["a1"]]);
		expect(events).toEqual(["assemble:a1", "run:a1", "commit:a1", "assemble:a2", "run:a2", "commit:a2"]);
	});

	it("a failing T2 commit leaves the response for T4 instead of failing the route", async () => {
		const router = new AgentRouter({
			assemble: (prepared) => context(prepared.agentId),
			runner: {
				async run({ prepared }) {
					return completion(prepared.agentId);
				},
			},
			committer: {
				commit() {
					throw new Error("t2_transient");
				},
			},
		});

		const routed = await router.routeAgents([target("a1")], "serial");

		expect(routed.errors).toEqual([]);
		expect(routed.results).toHaveLength(1);
	});
});
