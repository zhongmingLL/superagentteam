import { randomUUID } from "node:crypto";

import type { QueueEntry } from "@superagentteam/shared/types";
import { disabledRuntimeTelemetry, type RuntimeTelemetry } from "../../../observability/runtime-telemetry.ts";
import type { MessageStore } from "../../messages/store.ts";
import type { ThreadStore } from "../../threads/store.ts";
import type { QueueLedgerStore } from "../ledger/store.ts";
import type { QueueProcessor } from "../processor/index.ts";
import type { InvocationTracker } from "../tracker/index.ts";
import type { SteerRegistry } from "./registry.ts";

// F053: one target-scoped steer action.
//
// guide    -> inject into the exact live turn, retire the target, no cancel.
// interrupt-> cancel that target's live turn (if any), promote the entry, then
//             start the same queue row through the normal QueueProcessor.

export type SteerMode = "guide" | "interrupt";

export type SteerErrorCode =
	| "thread_not_found"
	| "forbidden"
	| "entry_not_found"
	| "entry_processing"
	| "target_not_pending"
	| "no_active_turn"
	| "steer_unavailable"
	| "steer_failed"
	| "not_startable";

export type SteerResult =
	| { outcome: "guided"; targetAgentId: string; disposition: string }
	| { outcome: "started"; targetAgentId: string; parentInvocationId: string; dispatched: string[] }
	| { outcome: "queued"; targetAgentId: string; reason: string }
	| { outcome: "rejected"; code: SteerErrorCode; message: string };

export interface SteerServiceDeps {
	threads: ThreadStore;
	queue: QueueLedgerStore;
	messages: MessageStore;
	tracker: InvocationTracker;
	registry: SteerRegistry;
	processor: Pick<QueueProcessor, "processEntry">;
	telemetry?: RuntimeTelemetry;
	clock?: () => number;
	newClaimId?: () => string;
	claimTtlMs?: number;
}

export interface SteerInput {
	threadId: string;
	queueEntryId: string;
	targetAgentId: string;
	mode: SteerMode;
	userId: string;
}

const DEFAULT_CLAIM_TTL_MS = 15_000;

export class SteerService {
	private readonly deps: SteerServiceDeps;
	private readonly clock: () => number;
	private readonly newClaimId: () => string;
	private readonly claimTtlMs: number;
	private readonly telemetry: RuntimeTelemetry;

	constructor(deps: SteerServiceDeps) {
		this.deps = deps;
		this.clock = deps.clock ?? Date.now;
		this.newClaimId = deps.newClaimId ?? (() => `steer:${randomUUID()}`);
		this.claimTtlMs = deps.claimTtlMs ?? DEFAULT_CLAIM_TTL_MS;
		this.telemetry = deps.telemetry ?? disabledRuntimeTelemetry("steer_service");
	}

	async steer(input: SteerInput): Promise<SteerResult> {
		const span = this.telemetry.startSpan("superagentteam.steer", {
			"thread.id": input.threadId,
			"agent.id": input.targetAgentId,
			"queue.entry.id": input.queueEntryId,
			"steer.mode": input.mode,
		});
		try {
			const result = await this.steerInner(input);
			span?.setAttribute("status", result.outcome);
			span?.setStatus(result.outcome === "rejected" ? "error" : "ok");
			this.telemetry.recordSteer(input.mode, result.outcome);
			return result;
		} catch (error) {
			span?.setStatus("error", "steer_exception");
			this.telemetry.recordSteer(input.mode, "exception");
			this.telemetry.recordError("steer", "exception");
			throw error;
		} finally {
			span?.end();
		}
	}

	private async steerInner(input: SteerInput): Promise<SteerResult> {
		const thread = this.deps.threads.get(input.threadId);
		if (!thread || (thread.deletedAt !== null && thread.deletedAt !== undefined)) {
			return reject("thread_not_found", `thread ${input.threadId} not found`);
		}
		if (thread.createdBy !== input.userId) {
			return reject("forbidden", `thread ${input.threadId} belongs to another user`);
		}
		const entry = this.deps.queue.get(input.threadId, input.queueEntryId);
		if (!entry) return reject("entry_not_found", `queue entry ${input.queueEntryId} not found`);
		if (entry.status !== "queued") {
			return reject("entry_processing", "queue entry is already being processed");
		}
		const targetKey = `agent:${input.targetAgentId}`;
		if (!entry.targets.some((target) => `agent:${target.id}` === targetKey)) {
			return reject("target_not_pending", `agent ${input.targetAgentId} is no longer pending`);
		}

		const now = this.clock();
		const claimId = this.newClaimId();
		const claimed = this.deps.queue.claim(input.threadId, input.queueEntryId, {
			claimId,
			owner: `operator:${input.userId}`,
			ttlMs: this.claimTtlMs,
			targetKeys: [targetKey],
			now,
		});
		if (claimed.outcome === "not_found") {
			return reject("entry_not_found", `queue entry ${input.queueEntryId} not found`);
		}
		if (claimed.outcome !== "claimed") {
			return reject("entry_processing", "queue entry changed while steering");
		}

		if (input.mode === "guide") return await this.guide(input, claimed.entry, claimId);
		return await this.interrupt(input, claimed.entry, claimId);
	}

	private async guide(input: SteerInput, entry: QueueEntry, claimId: string): Promise<SteerResult> {
		const binding = this.deps.registry.get(input.threadId, input.targetAgentId);
		const exactTurnId = this.deps.tracker.getExecutionId(input.threadId, input.targetAgentId);
		if (!binding || !exactTurnId || binding.turnExecutionId !== exactTurnId) {
			this.release(input.threadId, entry.queueEntryId, claimId);
			return reject("no_active_turn", `agent ${input.targetAgentId} has no steerable active turn`);
		}

		try {
			const { disposition } = await binding.steer(entry.payload.content);
			const now = this.clock();
			if (entry.payload.messageId) {
				// The receipt is best-effort: the steer already reached the worker,
				// so a bookkeeping failure must not leave the target queued.
				try {
					this.deps.messages.appendDispatchRef(
						entry.payload.messageId,
						{
							target: { kind: "agent", id: input.targetAgentId },
							queueEntryId: entry.queueEntryId,
							attempt: binding.attempt,
							turnExecutionId: binding.turnExecutionId,
							at: now,
						},
						now,
					);
				} catch {
					// Keep the delivery truth at the Queue layer; a later settlement
					// cannot reconstruct this receipt, but double delivery is worse.
				}
			}
			const retired = this.deps.queue.retireTargets(input.threadId, entry.queueEntryId, claimId, {
				targetKeys: [`agent:${input.targetAgentId}`],
				now,
			});
			if (retired.outcome === "retired_all") {
				this.deps.queue.deleteEntry(input.threadId, entry.queueEntryId, { claimId });
			} else if (retired.outcome === "updated") {
				this.release(input.threadId, entry.queueEntryId, claimId);
			} else {
				// The steer is already live; surface the unsafe projection instead
				// of pretending the target was retired.
				this.release(input.threadId, entry.queueEntryId, claimId);
				return reject("steer_failed", `steer retire failed: ${retired.outcome}`);
			}
			return { outcome: "guided", targetAgentId: input.targetAgentId, disposition };
		} catch (error) {
			this.release(input.threadId, entry.queueEntryId, claimId);
			const message = error instanceof Error ? error.message : String(error);
			return reject(
				message === "steer_unavailable" ? "steer_unavailable" : "steer_failed",
				`steer failed: ${message}`,
			);
		}
	}

	private async interrupt(input: SteerInput, entry: QueueEntry, claimId: string): Promise<SteerResult> {
		const now = this.clock();
		if (this.deps.tracker.has(input.threadId, input.targetAgentId)) {
			this.deps.tracker.cancel(input.threadId, input.targetAgentId);
		}
		// A deferred start must come back promptly; the claim is held here and
		// processEntry releases it on every non-started path.
		this.deps.queue.setPriority(input.threadId, entry.queueEntryId, "urgent", now);
		try {
			const result = await this.deps.processor.processEntry(entry, claimId, input.userId);
			if (result.outcome === "dispatched") {
				return {
					outcome: "started",
					targetAgentId: input.targetAgentId,
					parentInvocationId: result.parentInvocationId,
					dispatched: result.dispatched,
				};
			}
			if (result.outcome === "deferred") {
				return { outcome: "queued", targetAgentId: input.targetAgentId, reason: result.reason };
			}
			return reject("not_startable", `target cannot be started: ${result.invalid.join(", ")}`);
		} catch (error) {
			this.release(input.threadId, entry.queueEntryId, claimId);
			const message = error instanceof Error ? error.message : String(error);
			return reject("steer_failed", `interrupt failed: ${message}`);
		}
	}

	private release(threadId: string, queueEntryId: string, claimId: string): void {
		this.deps.queue.releaseClaim(threadId, queueEntryId, claimId, this.clock());
	}
}

function reject(code: SteerErrorCode, message: string): SteerResult {
	return { outcome: "rejected", code, message };
}
