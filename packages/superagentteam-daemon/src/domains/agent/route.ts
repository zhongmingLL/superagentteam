import type { HistoryWindow } from "../history/assembler.ts";
import { buildThreadPrompt, type HistoryAssembler } from "../history/assembler.ts";
import type { MessageStore } from "../message/store.ts";
import type { PreparedDispatch } from "../queue/processor.ts";
import type { ThreadStore } from "../thread/store.ts";
import type { AgentRegistry } from "./registry.ts";

// F044 route layer (0007 §3.5): QueueProcessor hands the Phase-A/B prepared
// targets to AgentRouter. routeParallel MUST assemble every child context at
// the batch boundary before any provider invocation starts, so siblings never
// observe each other's answers. routeSerial is the single-target operator/A2A
// hop (and the explicit serial mode for worklist tests); it keeps the same
// assemble → run → T2 commit → cleanup shape instead of bypassing the route.

export interface TurnContext {
	/** History snapshot captured by the route, not by the turn itself. */
	window: HistoryWindow;
	/** Prompt built from that same snapshot. */
	prompt: string;
}

export interface PriorResponse {
	agentId: string;
	content: string;
}

export interface AgentTurnResult {
	agentId: string;
	turnExecutionId: string;
	responseMessageId: string;
	status: "completed" | "failed" | "interrupted" | "canceled";
	responseText: string;
}

export interface AgentTurnInput {
	prepared: PreparedDispatch;
	context: TurnContext;
}

/**
 * T1 result plus the carrier release the route must call AFTER its T2 commit
 * (0007 §3.5 step 11 before step 14). The turn keeps ownership of worker
 * acquisition/release mechanics; the route owns when the release happens.
 */
export interface AgentTurnCompletion {
	result: AgentTurnResult;
	release(): Promise<void>;
}

export interface TurnRunner {
	run(input: AgentTurnInput): Promise<AgentTurnCompletion | null>;
}

export interface RouteCommitter {
	commit(result: AgentTurnResult): unknown;
}

export type AssembleContext = (prepared: PreparedDispatch, priorResponses: readonly PriorResponse[]) => TurnContext;

export interface RouteError {
	agentId: string;
	error: unknown;
}

export interface RouteResult {
	mode: "parallel" | "serial";
	results: AgentTurnResult[];
	errors: RouteError[];
}

export interface AgentRouterDeps {
	assemble: AssembleContext;
	runner: TurnRunner;
	committer: RouteCommitter;
}

export class AgentRouter {
	private readonly deps: AgentRouterDeps;

	constructor(deps: AgentRouterDeps) {
		this.deps = deps;
	}

	/**
	 * 0007 §3.5 routeAgents(mode). Parallel setup is synchronous and completes
	 * for every target before the first runner starts; per-target failures are
	 * isolated and returned for QueueProcessor's convergence/T3 ownership.
	 */
	async routeAgents(targets: readonly PreparedDispatch[], mode: "parallel" | "serial"): Promise<RouteResult> {
		return mode === "serial" ? this.routeSerial(targets) : this.routeParallel(targets);
	}

	private async routeParallel(targets: readonly PreparedDispatch[]): Promise<RouteResult> {
		const errors: RouteError[] = [];
		const worklist: Array<{ prepared: PreparedDispatch; context: TurnContext }> = [];

		// Barrier: no runner may start until all contexts are assembled.
		for (const prepared of targets) {
			try {
				worklist.push({ prepared, context: this.deps.assemble(prepared, []) });
			} catch (error) {
				errors.push({ agentId: prepared.agentId, error });
			}
		}

		const settled = await Promise.all(
			worklist.map(async (item) => {
				try {
					const completion = await this.deps.runner.run(item);
					if (!completion) return { result: null };
					this.commit(completion.result);
					await completion.release();
					return { result: completion.result };
				} catch (error) {
					return { error };
				}
			}),
		);

		const results: AgentTurnResult[] = [];
		for (let index = 0; index < settled.length; index += 1) {
			const item = settled[index]!;
			if ("error" in item) {
				errors.push({ agentId: worklist[index]!.prepared.agentId, error: item.error });
			} else if (item.result) {
				results.push(item.result);
			}
		}
		return { mode: "parallel", results, errors };
	}

	private async routeSerial(targets: readonly PreparedDispatch[]): Promise<RouteResult> {
		const results: AgentTurnResult[] = [];
		const errors: RouteError[] = [];
		const priorResponses: PriorResponse[] = [];

		for (const prepared of targets) {
			let context: TurnContext;
			try {
				context = this.deps.assemble(prepared, priorResponses);
			} catch (error) {
				errors.push({ agentId: prepared.agentId, error });
				continue;
			}
			try {
				const completion = await this.deps.runner.run({ prepared, context });
				if (!completion) continue;
				this.commit(completion.result);
				await completion.release();
				results.push(completion.result);
				priorResponses.push({ agentId: completion.result.agentId, content: completion.result.responseText });
			} catch (error) {
				errors.push({ agentId: prepared.agentId, error });
			}
		}
		return { mode: "serial", results, errors };
	}

	/** T2 failure leaves response_pending for T4; it never fails the turn. */
	private commit(result: AgentTurnResult): void {
		try {
			this.deps.committer.commit(result);
		} catch {
			// ResponseRecoveryService owns the retry.
		}
	}
}

export interface ContextAssemblerDeps {
	assembler: HistoryAssembler;
	registry: AgentRegistry;
	threads: ThreadStore;
	messages: MessageStore;
}

/**
 * 0007 §3.5.1 context assembly for one child: queue-source snapshot first,
 * then the exact prompt. Serial prior responses are appended after the thread
 * snapshot so the next target can see earlier answers without mutating the
 * history window/ack boundary.
 */
export function createContextAssembler(deps: ContextAssemblerDeps): AssembleContext {
	return (prepared, priorResponses) => {
		const sourceMessage =
			prepared.sourceMessageId === null
				? null
				: deps.messages.get(prepared.sourceMessageId, { includeDeleted: true });
		const window = deps.assembler.loadHistory(prepared.threadId, prepared.agentId, undefined, {
			...(sourceMessage !== null ? { upToSeq: sourceMessage.seq } : {}),
			...(prepared.sourceMessageId !== null ? { includeSourceMessageId: prepared.sourceMessageId } : {}),
		});
		const thread = deps.threads.get(prepared.threadId);
		if (!thread) throw new Error(`route_thread_missing: ${prepared.threadId}`);
		const basePrompt = buildThreadPrompt({
			thread,
			participants: deps.threads.listParticipants(prepared.threadId),
			rows: window.rows,
			selfAgentId: prepared.agentId,
			knownAgents: [...deps.registry.agents.values()]
				.filter((agent) => agent.enabled)
				.map((agent) => ({
					id: agent.id,
					displayName: agent.displayName,
					mentionPatterns: agent.mentionPatterns,
				})),
		});
		const prompt =
			priorResponses.length === 0 ? basePrompt : `${basePrompt}\n${renderPriorResponses(priorResponses)}`;
		return { window, prompt };
	};
}

function renderPriorResponses(priorResponses: readonly PriorResponse[]): string {
	return [
		"## Responses from earlier agents in this route",
		...priorResponses.map((prior) => `- @${prior.agentId}: ${prior.content}`),
		"",
	].join("\n");
}
