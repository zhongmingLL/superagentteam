import type { DatabaseSync } from "node:sqlite";
import type { AgentConfig, MessageLifecycle, QueueExecution } from "@superagentteam/shared/types";
import { runInTransaction } from "../../infrastructure/db/database.ts";
import type { SpanContext } from "../../observability/tracer.ts";
import type { A2ALog } from "../../shared/a2a-log.ts";
import { WORKER_CREDENTIAL_TOOL_NAMES } from "../a2a/tools/tool-service.ts";
import type { InvocationCredentialStore } from "../credentials/store.ts";
import type { InvocationAttemptStore, TurnExecutionStore } from "../invocation/index.ts";
import type { MessageStore } from "../messages/store.ts";
import type { QueueLedgerStore } from "../queue/ledger/store.ts";
import type { AgentSessionStore } from "../sessions/store.ts";
import type { ResponseDraftStore } from "../streaming/store.ts";

// F044b invoke-single-agent (0007 §3.6): the Phase B owner. QueueProcessor
// keeps the Phase A reservation (parent + attempts `starting`) and hands the
// prepared target to the route; the per-agent runner calls begin() before any
// provider work. Phase B is ONE transaction: processing R + TurnExecution +
// attempt bindAppended + credential + draft + input dispatchRef + retireTargets.
// A Phase B failure is typed: the attempt goes starting→failed, a
// delivery_failure is written, and the target stays pending for bounded retry.
// Provider-phase failures after Phase B keep their own convergence path.

export interface PreparedDispatch {
	threadId: string;
	userId: string;
	parentInvocationId: string;
	queueEntryId: string;
	/** Admission source id; Phase B causal trigger fallback. */
	sourceRecordId: string;
	sourceMessageId: string | null;
	agentId: string;
	agentConfig: AgentConfig;
	provider: string;
	model: string;
	attemptId: string;
	turnExecutionId: string;
	agentSessionId: string;
	claimId: string;
	execution: QueueExecution;
	/** Tracker-owned abort signal; operator cancel aborts this turn. */
	signal?: AbortSignal;
	/** F055: parent queue/route span for the turn trace. */
	trace?: SpanContext;
}

export type DeliveryFailureReason = Extract<MessageLifecycle, { kind: "delivery_failure" }>["reason"];

export interface PhaseBCommit {
	responseMessageId: string;
	credentialToken: string;
}

export interface PrestartFailureDeps {
	db: DatabaseSync;
	attempts: InvocationAttemptStore;
	messages: MessageStore;
}

export interface InvokeSingleAgentDeps extends PrestartFailureDeps {
	turns: TurnExecutionStore;
	credentials: InvocationCredentialStore;
	drafts: ResponseDraftStore;
	sessions: AgentSessionStore;
	queue: QueueLedgerStore;
	clock?: () => number;
	log?: A2ALog;
}

export interface PhaseBErrorInput {
	agentId: string;
	attemptId: string;
	reason: DeliveryFailureReason;
	/** False when the attempt was not in `starting` and nothing was written. */
	failureRecorded: boolean;
	cause: unknown;
}

/** Typed Phase B failure: QueueProcessor must not run provider convergence. */
export class PhaseBError extends Error {
	readonly agentId: string;
	readonly attemptId: string;
	readonly reason: DeliveryFailureReason;
	readonly failureRecorded: boolean;

	constructor(input: PhaseBErrorInput) {
		super(`phase_b_failed(${input.reason}): ${messageOf(input.cause)}`, { cause: input.cause });
		this.name = "PhaseBError";
		this.agentId = input.agentId;
		this.attemptId = input.attemptId;
		this.reason = input.reason;
		this.failureRecorded = input.failureRecorded;
	}
}

class PhaseBStepFailure extends Error {
	readonly reason: DeliveryFailureReason;

	constructor(reason: DeliveryFailureReason, cause: unknown) {
		super(messageOf(cause), { cause });
		this.name = "PhaseBStepFailure";
		this.reason = reason;
	}
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function step<T>(reason: DeliveryFailureReason, fn: () => T): T {
	try {
		return fn();
	} catch (error) {
		if (error instanceof PhaseBStepFailure) throw error;
		throw new PhaseBStepFailure(reason, error);
	}
}

/**
 * Prestart failure bookkeeping shared by Phase B and route setup: attempt
 * starting→failed + one idempotent delivery_failure row. The target is left on
 * the queue entry by the caller (never retired), so the bounded retry owns it.
 */
export function recordPrestartFailure(
	deps: PrestartFailureDeps,
	prepared: PreparedDispatch,
	input: { terminalReason: string; reason: DeliveryFailureReason; detail: string; now: number },
): boolean {
	try {
		runInTransaction(deps.db, () => {
			const terminal = deps.attempts.markPrestartTerminal(prepared.attemptId, {
				status: "failed",
				terminalReason: input.terminalReason,
				endedAt: input.now,
			});
			if (!terminal || terminal.deliveryState !== "failed") {
				throw new Error(`prestart_terminal_unavailable: ${prepared.attemptId}`);
			}
			const failureId = `df:${prepared.attemptId}`;
			if (!deps.messages.get(failureId, { includeDeleted: true })) {
				deps.messages.append({
					id: failureId,
					threadId: prepared.threadId,
					from: { kind: "system", service: "queue" },
					content: `delivery_failure (${input.reason}): ${input.detail}`,
					lifecycle: {
						kind: "delivery_failure",
						status: "failed",
						sourceEntryId: prepared.queueEntryId,
						inputMessageId: prepared.sourceMessageId ?? prepared.sourceRecordId,
						requestedTargets: [{ kind: "agent", id: prepared.agentId }],
						reason: input.reason,
						createdAt: input.now,
					},
					now: input.now,
				});
			}
		});
		return true;
	} catch {
		return false;
	}
}

export class InvokeSingleAgent {
	private readonly deps: InvokeSingleAgentDeps;
	private readonly clock: () => number;

	constructor(deps: InvokeSingleAgentDeps) {
		this.deps = deps;
		this.clock = deps.clock ?? Date.now;
	}

	private fail(prepared: PreparedDispatch, reason: DeliveryFailureReason, cause: unknown): PhaseBError {
		const recorded = recordPrestartFailure(this.deps, prepared, {
			terminalReason: "phase_b_failed",
			reason,
			detail: messageOf(cause),
			now: this.clock(),
		});
		this.deps.log?.("warn", "phase_b_failed", {
			thread_id: prepared.threadId,
			invocation_id: prepared.parentInvocationId,
			queue_entry_id: prepared.queueEntryId,
			attempt: this.deps.attempts.get(prepared.attemptId)?.attempt,
			provider: prepared.provider,
			model: prepared.model,
			error_code: reason,
		});
		return new PhaseBError({
			agentId: prepared.agentId,
			attemptId: prepared.attemptId,
			reason,
			failureRecorded: recorded,
			cause,
		});
	}

	/**
	 * 0007 §3.6 Phase B. Returns the R id + minted credential token for the
	 * provider phase. Throws PhaseBError when Phase B (or its precondition)
	 * fails; no provider work may start in that case.
	 */
	begin(prepared: PreparedDispatch): PhaseBCommit {
		const attempt = this.deps.attempts.get(prepared.attemptId);
		if (!attempt) {
			throw new PhaseBError({
				agentId: prepared.agentId,
				attemptId: prepared.attemptId,
				reason: "phase_b_failed",
				failureRecorded: false,
				cause: new Error(`attempt_not_found: ${prepared.attemptId}`),
			});
		}
		if (attempt.deliveryState !== "starting") {
			throw new PhaseBError({
				agentId: prepared.agentId,
				attemptId: prepared.attemptId,
				reason: "phase_b_failed",
				failureRecorded: false,
				cause: new Error(`attempt_not_starting: ${attempt.deliveryState}`),
			});
		}
		const session = this.deps.sessions.get(prepared.agentSessionId);
		if (!session || session.status !== "active" || attempt.agentSessionId !== prepared.agentSessionId) {
			throw this.fail(prepared, "phase_b_failed", new Error("attempt_session_not_active"));
		}

		const now = this.clock();
		let commit: PhaseBCommit;
		try {
			commit = runInTransaction(this.deps.db, () => {
				const responseMessageId = `resp:${prepared.turnExecutionId}`;
				step("response_create_failed", () => {
					this.deps.messages.append({
						id: responseMessageId,
						threadId: prepared.threadId,
						from: { kind: "agent", agentId: prepared.agentId },
						content: "",
						lifecycle: {
							kind: "response",
							parentInvocationId: prepared.parentInvocationId,
							turnExecutionId: prepared.turnExecutionId,
							target: { kind: "agent", id: prepared.agentId },
							status: "processing",
							startedAt: now,
						},
						now,
					});
				});
				const turn = step("turn_create_failed", () =>
					this.deps.turns.createRunning({
						turnExecutionId: prepared.turnExecutionId,
						parentInvocationId: prepared.parentInvocationId,
						threadId: prepared.threadId,
						userId: prepared.userId,
						agentId: prepared.agentId,
						executionKind: "ordinary",
						causal: {
							triggerMessageId: prepared.sourceMessageId ?? prepared.sourceRecordId,
							...(prepared.execution.a2aParentTurnExecutionId
								? { a2aParentTurnExecutionId: prepared.execution.a2aParentTurnExecutionId }
								: {}),
							...(prepared.execution.a2aTriggerMessageId
								? { a2aTriggerMessageId: prepared.execution.a2aTriggerMessageId }
								: {}),
							a2aDepth: prepared.execution.a2aDepth,
							...(prepared.execution.multiMentionRequestId
								? { multiMentionRequestId: prepared.execution.multiMentionRequestId }
								: {}),
							...(prepared.execution.multiMentionCallbackDepth !== null
								? { multiMentionCallbackDepth: prepared.execution.multiMentionCallbackDepth }
								: {}),
						},
						startedAt: now,
					}),
				);
				if (turn.outcome !== "created") throw new PhaseBStepFailure("turn_create_failed", turn.outcome);
				step("phase_b_failed", () => {
					const bound = this.deps.attempts.bindAppended(prepared.attemptId, {
						turnExecutionId: prepared.turnExecutionId,
						agentSessionId: prepared.agentSessionId,
						workerId: null,
						provider: prepared.provider,
						model: prepared.model,
						modelFamily: null,
						responseMessageId,
						now,
					});
					if (!bound || bound.deliveryState !== "appended") {
						throw new Error(`attempt_bind_appended_failed: ${prepared.attemptId}`);
					}
				});
				const minted = step("credential_mint_failed", () =>
					this.deps.credentials.create({
						turnExecutionId: prepared.turnExecutionId,
						parentInvocationId: prepared.parentInvocationId,
						threadId: prepared.threadId,
						agentId: prepared.agentId,
						agentSessionId: prepared.agentSessionId,
						userId: prepared.userId,
						allowedTools: [...WORKER_CREDENTIAL_TOOL_NAMES],
						now,
					}),
				);
				if (!minted.token) throw new PhaseBStepFailure("credential_mint_failed", "token_missing");
				step("draft_create_failed", () => {
					this.deps.drafts.create({
						attemptId: prepared.attemptId,
						turnExecutionId: prepared.turnExecutionId,
						parentInvocationId: prepared.parentInvocationId,
						threadId: prepared.threadId,
						agentId: prepared.agentId,
						content: "",
						toolEvents: [],
						thinking: null,
						richBlocks: [],
						createdAt: now,
						updatedAt: now,
					});
				});
				if (prepared.sourceMessageId) {
					// Callback deliveries use multi_mention_callbacks, not input
					// dispatchRefs; only real input messages carry refs.
					const sourceMessage = this.deps.messages.get(prepared.sourceMessageId, { includeDeleted: true });
					if (sourceMessage?.lifecycle?.kind === "input") {
						step("phase_b_failed", () => {
							this.deps.messages.appendDispatchRef(
								prepared.sourceMessageId!,
								{
									target: { kind: "agent", id: prepared.agentId },
									queueEntryId: prepared.queueEntryId,
									attempt: this.deps.attempts.get(prepared.attemptId)?.attempt ?? 1,
									turnExecutionId: prepared.turnExecutionId,
									at: now,
								},
								now,
							);
						});
					}
				}
				// A lost claim must NOT commit R/child/credential for a pending
				// target (double-dispatch risk): the whole Phase B rolls back.
				const retired = step("retire_targets_failed", () =>
					this.deps.queue.retireTargets(prepared.threadId, prepared.queueEntryId, prepared.claimId, {
						targetKeys: [`agent:${prepared.agentId}`],
						now,
					}),
				);
				if (retired.outcome !== "updated" && retired.outcome !== "retired_all") {
					throw new PhaseBStepFailure("retire_targets_failed", `retire_state:${retired.outcome}`);
				}
				return { responseMessageId, credentialToken: minted.token };
			});
		} catch (error) {
			const reason = error instanceof PhaseBStepFailure ? error.reason : "phase_b_failed";
			const cause = error instanceof PhaseBStepFailure ? (error.cause ?? error) : error;
			throw this.fail(prepared, reason, cause);
		}

		this.deps.log?.("info", "phase_b_appended", {
			thread_id: prepared.threadId,
			invocation_id: prepared.parentInvocationId,
			queue_entry_id: prepared.queueEntryId,
			attempt: attempt.attempt,
			provider: prepared.provider,
			model: prepared.model,
			phase: "phase_b",
		});
		return commit;
	}
}
