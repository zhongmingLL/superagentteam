import type { DatabaseSync } from "node:sqlite";
import type { AgentStreamEvent } from "@superagentteam/shared/types";
import { runInTransaction } from "../../infrastructure/db/database.ts";
import type { A2ALog } from "../../shared/a2a-log.ts";
import type { AgentTurnCompletion, AgentTurnInput, AgentTurnResult, TurnRunner } from "../a2a/routing/route.ts";
import type { InvocationCredentialStore } from "../credentials/store.ts";
import type { InvocationAttemptStore, TurnExecutionStore } from "../invocation/index.ts";
import { TurnExecutionLifecycle } from "../invocation/settlement/index.ts";
import type { AgentReadStateStore, MessageStore } from "../messages/store.ts";
import type { SteerRegistry } from "../queue/steer/registry.ts";
import type { AgentSessionStore } from "../sessions/store.ts";
import { ResponseEventSink } from "../streaming/sink.ts";
import type { ResponseDraftStore } from "../streaming/store.ts";
import type { ThreadStore } from "../threads/store.ts";
import type { WorkerPool } from "../workers/pool.ts";
import type { WorkerPoolKey } from "../workers/store.ts";
import type { InvokeSingleAgent } from "./invoke-single-agent.ts";

// F018 R2-b runAgentTurn (0007 §3.5 / 0010 §6.1.1 steps 2-8): the real
// TurnRunner. The route owns context assembly (batch-barrier snapshot + prompt)
// and T2 settlement; invoke-single-agent owns Phase B; this class acquires the
// worker, prompts it, streams into response_drafts + ephemeral AgentStreamEvents,
// records usage, and owns T1. On failure before T1 it throws CLEAN
// (QueueProcessor convergence owns turn/attempt/credential/R).

export class TurnCanceledError extends Error {
	constructor() {
		super("turn_canceled");
		this.name = "TurnCanceledError";
	}
}

export interface RunAgentTurnDeps {
	db: DatabaseSync;
	pool: WorkerPool;
	attempts: InvocationAttemptStore;
	sessions: AgentSessionStore;
	drafts: ResponseDraftStore;
	threads: ThreadStore;
	/** T1 child-terminal settlement deps (T2 is route-owned). */
	turns: TurnExecutionStore;
	credentials: InvocationCredentialStore;
	readState: AgentReadStateStore;
	messages: MessageStore;
	/** Phase B owner (0007 §3.6): R + TurnExecution + credential + draft + retire. */
	invokeSingleAgent: InvokeSingleAgent;
	onStreamEvent?: (event: AgentStreamEvent, threadId: string) => void;
	/** F053: live-turn steering registry (process-local). */
	steerRegistry?: SteerRegistry;
	log?: A2ALog;
	clock?: () => number;
	promptTimeoutMs?: number;
}

export class RunAgentTurn implements TurnRunner {
	private readonly deps: RunAgentTurnDeps;
	private readonly clock: () => number;

	constructor(deps: RunAgentTurnDeps) {
		this.deps = deps;
		this.clock = deps.clock ?? Date.now;
	}

	private settlementDeps() {
		return {
			db: this.deps.db,
			turns: this.deps.turns,
			attempts: this.deps.attempts,
			credentials: this.deps.credentials,
			sessions: this.deps.sessions,
			readState: this.deps.readState,
			messages: this.deps.messages,
			drafts: this.deps.drafts,
			threads: this.deps.threads,
			clock: this.clock,
		};
	}

	async run(input: AgentTurnInput): Promise<AgentTurnCompletion> {
		const { prepared, context } = input;
		// Phase B comes first: if it fails, invoke-single-agent already recorded
		// the typed prestart failure and this runner must not touch the provider.
		const phaseB = this.deps.invokeSingleAgent.begin(prepared);
		const now = this.clock();
		const session = this.deps.sessions.get(prepared.agentSessionId);
		if (!session || session.status !== "active") {
			throw new Error(`turn_session_not_active: ${prepared.agentId}`);
		}
		const attempt = this.deps.attempts.get(prepared.attemptId);
		if (!attempt || attempt.deliveryState !== "appended") {
			throw new Error(`turn_attempt_not_appended: ${prepared.attemptId}`);
		}
		const aborted = (): boolean => prepared.signal?.aborted === true;

		// Step 2: the route already captured the history snapshot and prompt at
		// the batch boundary; ack still happens only in T1.
		const window = context.window;

		// Step 3: acquire the ephemeral worker and bind it to the attempt.
		const poolKey: WorkerPoolKey = {
			projectPath: this.deps.threads.get(prepared.threadId)?.projectPath ?? "",
			accountRef: prepared.agentConfig.accountRef,
			provider: prepared.provider,
			model: prepared.model,
		};
		// P2-3 (review): ensure → bindPiSession live INSIDE the guarded region —
		// a failure between acquiring the worker and the try block must not
		// leak the worker (port contract: release before any throw).
		let handle: Awaited<ReturnType<WorkerPool["ensure"]>> | null = null;
		let abortCleanup: (() => void) | null = null;
		let handedOff = false;
		let released = false;
		const completion = (result: AgentTurnResult): AgentTurnCompletion => {
			handedOff = true;
			this.deps.log?.("info", "turn_terminal", {
				thread_id: prepared.threadId,
				invocation_id: prepared.parentInvocationId,
				queue_entry_id: prepared.queueEntryId,
				attempt: attempt.attempt,
				status: result.status,
				phase: "t1",
			});
			return {
				result,
				release: async () => {
					if (released) return;
					released = true;
					abortCleanup?.();
					if (handle) {
						await this.deps.pool
							.release(handle, aborted() ? "operator-canceled" : "turn-complete")
							.catch(() => {});
					}
				},
			};
		};
		try {
			handle = await this.deps.pool.ensure(poolKey, session, phaseB.credentialToken);
			this.deps.attempts.bindWorker(prepared.attemptId, handle.workerId);
			this.deps.log?.("info", "turn_worker_bound", {
				thread_id: prepared.threadId,
				invocation_id: prepared.parentInvocationId,
				queue_entry_id: prepared.queueEntryId,
				attempt: attempt.attempt,
				provider: prepared.provider,
				model: prepared.model,
				session_id: handle.piSessionId,
				duration_ms: Math.round(handle.spawnMs),
				phase: "t1",
			});
			const onAbort = (): void => {
				void handle?.connection.finish("operator-canceled").catch(() => {});
			};
			if (prepared.signal) {
				if (prepared.signal.aborted) onAbort();
				else prepared.signal.addEventListener("abort", onAbort, { once: true });
			}
			abortCleanup = () => prepared.signal?.removeEventListener("abort", onAbort);

			// Bind the pi session identity on first spawn (resume continuity).
			if (handle.piSessionId && handle.piSessionFile && session.piSessionId === null) {
				runInTransaction(this.deps.db, () => {
					this.deps.sessions.bindPiSession(session.id, {
						piSessionId: handle!.piSessionId,
						piSessionFile: handle!.piSessionFile,
						now,
					});
				});
			}

			const sink = new ResponseEventSink({
				drafts: this.deps.drafts,
				attemptId: prepared.attemptId,
				turnExecutionId: prepared.turnExecutionId,
				parentInvocationId: prepared.parentInvocationId,
				threadId: prepared.threadId,
				agentId: prepared.agentId,
				createdAt: now,
				onStreamEvent: (event) => this.deps.onStreamEvent?.(event, prepared.threadId),
				onFirstVisibleOutput: () => {
					runInTransaction(this.deps.db, () => {
						this.deps.sessions.recordUserVisibleOutput(
							prepared.agentSessionId,
							prepared.turnExecutionId,
							this.clock(),
						);
					});
				},
				clock: this.clock,
			});
			const offEvent = handle.connection.onEvent((event) => sink.handle(event));
			// F053: expose the live worker RPC only for the exact prompt window.
			const detachSteer =
				this.deps.steerRegistry?.attach({
					threadId: prepared.threadId,
					agentId: prepared.agentId,
					turnExecutionId: prepared.turnExecutionId,
					attempt: attempt.attempt,
					steer: async (message) => {
						if (!handle?.connection.steer) throw new Error("steer_unavailable");
						return await handle.connection.steer(message);
					},
				}) ?? (() => {});

			try {
				// Step 5: prompt RPC. markPromptDelivered fires from onAccepted —
				// the provider has the payload; later failures still ack
				// (0010 §6.1.3 row 7 semantics live in T1/R2-c).
				const promptResult = await handle.connection.promptAndWait(context.prompt, {
					timeoutMs: this.deps.promptTimeoutMs ?? 300_000,
					signal: prepared.signal,
					onAccepted: () => {
						runInTransaction(this.deps.db, () => {
							this.deps.attempts.markPromptDelivered(prepared.attemptId, {
								deliveryBoundarySeq: window.boundarySeq,
								now: this.clock(),
							});
						});
					},
				});
				if (promptResult.aborted || aborted()) throw new TurnCanceledError();
			} finally {
				detachSteer();
				offEvent();
			}

			if (aborted()) throw new TurnCanceledError();
			const summary = sink.summary();
			const lifecycle = new TurnExecutionLifecycle(this.settlementDeps());

			if (summary.errorMessage) {
				// 0010 §6.1.3 rows 6-7 split on prompt delivery:
				// - prompt ACCEPTED then failed → T1 failed (ack! no replay —
				//   next round sees the failed R); the route then commits T2.
				// - prompt never accepted → clean throw: the R2-a convergence
				//   terminalizes the chain and restores the target to replay.
				const fresh = this.deps.attempts.get(prepared.attemptId);
				if (fresh?.promptDeliveredAt) {
					const t1f = lifecycle.invokeTerminal({
						turnExecutionId: prepared.turnExecutionId,
						status: "failed",
						endedAt: this.clock(),
						terminalReason: `provider_error: ${summary.errorMessage}`,
						userVisibleOutput: false,
					});
					if (t1f.outcome === "not_found" || t1f.outcome === "terminal_conflict") {
						throw new Error(`t1_failed: ${t1f.outcome}`);
					}
					return completion({
						agentId: prepared.agentId,
						turnExecutionId: prepared.turnExecutionId,
						responseMessageId: phaseB.responseMessageId,
						status: "failed",
						responseText: summary.content,
					});
				}
				throw new Error(`turn_provider_error: ${summary.errorMessage}`);
			}
			if (summary.usage) {
				this.deps.attempts.recordUsage(prepared.attemptId, summary.usage);
			}

			// T1 child terminal (0010 §6.1.1 step 9): ONE transaction — child
			// terminal + attempt projection + response_pending + credential +
			// recordCompletedTurn + cursor ack (promptDelivered-gated).
			const t1 = lifecycle.invokeTerminal({
				turnExecutionId: prepared.turnExecutionId,
				status: "completed",
				endedAt: this.clock(),
				userVisibleOutput: summary.content.trim().length > 0,
			});
			if (t1.outcome === "not_found" || t1.outcome === "terminal_conflict") {
				throw new Error(`t1_failed: ${t1.outcome}`);
			}
			// T2 is route-owned; returning here leaves response_pending for the
			// route commit, or for T4 if the commit fails.
			return completion({
				agentId: prepared.agentId,
				turnExecutionId: prepared.turnExecutionId,
				responseMessageId: phaseB.responseMessageId,
				status: "completed",
				responseText: summary.content,
			});
		} finally {
			// Successful/failed-completed turns hand the carrier to the route so
			// T2 commits before release (0007 §3.5 step 11 before step 14). A
			// clean throw before T1 releases here; the port contract still
			// forbids leaking a worker.
			if (!handedOff) {
				abortCleanup?.();
				if (handle) {
					await this.deps.pool.release(handle, aborted() ? "operator-canceled" : "turn-complete").catch(() => {});
				}
			}
		}
	}
}
