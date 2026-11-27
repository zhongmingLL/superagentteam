import type { DatabaseSync } from "node:sqlite";
import type { InvocationAttempt, InvocationAttemptDeliveryState } from "@superagentteam/shared/types";
import { TurnExecutionStore } from "../turns/store.ts";

// ------------------------------------------------------ attempts (§4.3.1)

interface AttemptRow {
	attempt_id: string;
	parent_invocation_id: string;
	queue_entry_id: string;
	thread_id: string;
	target_agent_id: string;
	attempt: number;
	turn_execution_id: string | null;
	delivery_state: InvocationAttemptDeliveryState;
	terminal_reason: string | null;
	agent_session_id: string | null;
	worker_id: string | null;
	provider: string | null;
	model: string | null;
	model_family: string | null;
	usage_json: string | null;
	settlement: "streaming" | "response_pending" | "settled" | null;
	response_message_id: string | null;
	delivery_boundary_seq: number | null;
	prompt_delivered_at: number | null;
	created_at: number;
	started_at: number | null;
	ended_at: number | null;
}

function mapAttempt(row: AttemptRow): InvocationAttempt {
	return {
		attemptId: row.attempt_id,
		parentInvocationId: row.parent_invocation_id,
		queueEntryId: row.queue_entry_id,
		threadId: row.thread_id,
		targetAgentId: row.target_agent_id,
		attempt: row.attempt,
		turnExecutionId: row.turn_execution_id,
		deliveryState: row.delivery_state,
		terminalReason: row.terminal_reason,
		agentSessionId: row.agent_session_id,
		workerId: row.worker_id,
		provider: row.provider,
		model: row.model,
		modelFamily: row.model_family,
		usage: row.usage_json ? (JSON.parse(row.usage_json) as Record<string, unknown>) : null,
		settlement: row.settlement,
		responseMessageId: row.response_message_id,
		deliveryBoundarySeq: row.delivery_boundary_seq,
		promptDeliveredAt: row.prompt_delivered_at,
		createdAt: row.created_at,
		startedAt: row.started_at,
		endedAt: row.ended_at,
	};
}

export interface AppendAttemptInput {
	attemptId: string;
	parentInvocationId: string;
	queueEntryId: string;
	threadId: string;
	targetAgentId: string;
	attempt: number;
	now: number;
}

export class InvocationAttemptStore {
	private readonly db: DatabaseSync;
	private readonly turns: TurnExecutionStore;

	constructor(db: DatabaseSync, turns?: TurnExecutionStore) {
		this.db = db;
		this.turns = turns ?? new TurnExecutionStore(db);
	}

	/** Append-only ledger row; (parent, target, attempt) idempotent-create / conflict. */
	appendQueued(input: AppendAttemptInput): {
		outcome: "created" | "replayed" | "conflict";
		record: InvocationAttempt;
	} {
		// Parent alignment (0007 §4.3.1): thread and target must match the
		// parent record's admission snapshot.
		const parent = this.db
			.prepare("SELECT thread_id, target_agent_ids_json FROM invocation_records WHERE invocation_id = ?")
			.get(input.parentInvocationId) as { thread_id: string; target_agent_ids_json: string } | undefined;
		if (!parent) throw new Error("attempt_parent_not_found");
		if (parent.thread_id !== input.threadId) throw new Error("attempt_thread_not_parent_thread");
		const parentTargets = JSON.parse(parent.target_agent_ids_json) as string[];
		if (!parentTargets.includes(input.targetAgentId)) throw new Error("attempt_target_not_parent_target");
		const existing = this.db
			.prepare(
				"SELECT * FROM invocation_attempts WHERE parent_invocation_id = ? AND target_agent_id = ? AND attempt = ?",
			)
			.get(input.parentInvocationId, input.targetAgentId, input.attempt) as AttemptRow | undefined;
		if (existing) {
			return existing.queue_entry_id === input.queueEntryId
				? { outcome: "replayed", record: mapAttempt(existing) }
				: { outcome: "conflict", record: mapAttempt(existing) };
		}
		this.db
			.prepare(
				`INSERT INTO invocation_attempts (attempt_id, parent_invocation_id, queue_entry_id, thread_id, target_agent_id, attempt, delivery_state, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)`,
			)
			.run(
				input.attemptId,
				input.parentInvocationId,
				input.queueEntryId,
				input.threadId,
				input.targetAgentId,
				input.attempt,
				input.now,
			);
		return {
			outcome: "created",
			record: mapAttempt(
				this.db
					.prepare("SELECT * FROM invocation_attempts WHERE attempt_id = ?")
					.get(input.attemptId) as unknown as AttemptRow,
			),
		};
	}

	get(attemptId: string): InvocationAttempt | null {
		const row = this.db.prepare("SELECT * FROM invocation_attempts WHERE attempt_id = ?").get(attemptId) as
			| AttemptRow
			| undefined;
		return row ? mapAttempt(row) : null;
	}

	getByTurnExecutionId(turnExecutionId: string): InvocationAttempt | null {
		const row = this.db
			.prepare("SELECT * FROM invocation_attempts WHERE turn_execution_id = ?")
			.get(turnExecutionId) as AttemptRow | undefined;
		return row ? mapAttempt(row) : null;
	}

	getLatest(invocationId: string, targetAgentId: string): InvocationAttempt | null {
		const row = this.db
			.prepare(
				"SELECT * FROM invocation_attempts WHERE parent_invocation_id = ? AND target_agent_id = ? ORDER BY attempt DESC LIMIT 1",
			)
			.get(invocationId, targetAgentId) as AttemptRow | undefined;
		return row ? mapAttempt(row) : null;
	}

	listByInvocation(invocationId: string): InvocationAttempt[] {
		const rows = this.db
			.prepare("SELECT * FROM invocation_attempts WHERE parent_invocation_id = ? ORDER BY target_agent_id, attempt")
			.all(invocationId) as unknown as AttemptRow[];
		return rows.map(mapAttempt);
	}

	/** queued→starting only; Phase A reservation (0016 T1a). */
	markStarting(attemptId: string, input: { agentSessionId: string; now: number }): InvocationAttempt | null {
		const current = this.get(attemptId);
		if (!current) return null;
		if (current.deliveryState === "starting") {
			if (current.agentSessionId !== input.agentSessionId) {
				throw new Error("attempt_starting_session_conflict");
			}
			return current;
		}
		if (current.deliveryState !== "queued") return current;
		this.db
			.prepare(
				"UPDATE invocation_attempts SET delivery_state = 'starting', agent_session_id = ?, started_at = ? WHERE attempt_id = ? AND delivery_state = 'queued'",
			)
			.run(input.agentSessionId, input.now, attemptId);
		return this.get(attemptId);
	}

	/**
	 * starting→appended; writes execution binding snapshot (§4.3.1).
	 * `modelFamily` resolves at provider time (Phase B runs pre-worker), so it
	 * may be null here; re-bind identity comparison treats null == null.
	 */
	bindAppended(
		attemptId: string,
		input: {
			turnExecutionId: string;
			agentSessionId: string;
			workerId: string | null;
			provider: string;
			model: string;
			modelFamily: string | null;
			responseMessageId: string;
			now: number;
		},
	): InvocationAttempt | null {
		const current = this.get(attemptId);
		if (!current) return null;
		if (current.deliveryState === "appended") {
			// Idempotent re-bind: FULL binding identity must match; any drift
			// (session/provider/model/family too) fails closed.
			if (
				current.turnExecutionId !== input.turnExecutionId ||
				current.responseMessageId !== input.responseMessageId ||
				current.agentSessionId !== input.agentSessionId ||
				current.provider !== input.provider ||
				current.model !== input.model ||
				current.modelFamily !== input.modelFamily
			) {
				throw new Error("attempt_rebind_conflict");
			}
			return current;
		}
		if (current.deliveryState !== "starting") throw new Error("attempt_not_starting");
		this.db
			.prepare(
				`UPDATE invocation_attempts SET delivery_state = 'appended', turn_execution_id = ?, agent_session_id = ?, worker_id = COALESCE(?, worker_id), provider = ?, model = ?, model_family = ?, response_message_id = ?, settlement = 'streaming' WHERE attempt_id = ?`,
			)
			.run(
				input.turnExecutionId,
				input.agentSessionId,
				input.workerId,
				input.provider,
				input.model,
				input.modelFamily,
				input.responseMessageId,
				attemptId,
			);
		return this.get(attemptId);
	}

	bindWorker(attemptId: string, workerId: string): InvocationAttempt | null {
		const current = this.get(attemptId);
		if (!current) return null;
		if (current.workerId && current.workerId !== workerId) throw new Error("attempt_worker_conflict");
		if (current.workerId === workerId) return current;
		this.db.prepare("UPDATE invocation_attempts SET worker_id = ? WHERE attempt_id = ?").run(workerId, attemptId);
		return this.get(attemptId);
	}

	markPromptDelivered(
		attemptId: string,
		input: { deliveryBoundarySeq: number; now: number },
	): InvocationAttempt | null {
		const current = this.get(attemptId);
		if (!current) return null;
		if (current.promptDeliveredAt) {
			if (current.deliveryBoundarySeq !== input.deliveryBoundarySeq)
				throw new Error("attempt_prompt_boundary_conflict");
			return current;
		}
		if (current.deliveryState !== "appended") throw new Error("attempt_not_appended");
		this.db
			.prepare(
				"UPDATE invocation_attempts SET prompt_delivered_at = ?, delivery_boundary_seq = ? WHERE attempt_id = ?",
			)
			.run(input.now, input.deliveryBoundarySeq, attemptId);
		return this.get(attemptId);
	}

	setSettlement(
		attemptId: string,
		settlement: "streaming" | "response_pending" | "settled",
		responseMessageId?: string,
	): InvocationAttempt | null {
		const current = this.get(attemptId);
		if (current?.settlement === "settled" && settlement !== "settled") {
			throw new Error("attempt_settlement_regression");
		}
		this.db
			.prepare(
				"UPDATE invocation_attempts SET settlement = ?, response_message_id = COALESCE(?, response_message_id) WHERE attempt_id = ?",
			)
			.run(settlement, responseMessageId ?? null, attemptId);
		return this.get(attemptId);
	}

	/** Canonical-first projection (0016 §4.4): validates child status matches. */
	projectChildTerminal(
		attemptId: string,
		input: {
			turnExecutionId: string;
			childStatus: "completed" | "failed" | "interrupted" | "canceled";
			terminalReason: string | null;
			endedAt: number;
		},
	): { outcome: "transitioned" | "already_terminal" | "terminal_conflict" | "not_found" } {
		const current = this.get(attemptId);
		if (!current) return { outcome: "not_found" };
		// Canonical-first (0016 §4.4): read the TurnExecution and validate it
		// is the bound child with exactly this status — no attempt write may
		// invent or drift from child truth.
		if (current.turnExecutionId !== input.turnExecutionId) return { outcome: "terminal_conflict" };
		const child = this.turns.get(input.turnExecutionId);
		if (!child) throw new Error("attempt_child_not_found");
		if (child.status !== input.childStatus) return { outcome: "terminal_conflict" };
		if (current.deliveryState !== "appended") {
			const sameTerminal =
				(current.deliveryState === "handled" && input.childStatus === "completed") ||
				(current.deliveryState === input.childStatus &&
					(input.childStatus === "failed" ||
						input.childStatus === "interrupted" ||
						input.childStatus === "canceled"));
			return sameTerminal ? { outcome: "already_terminal" } : { outcome: "terminal_conflict" };
		}
		const mapped: InvocationAttemptDeliveryState = input.childStatus === "completed" ? "handled" : input.childStatus;
		if (mapped !== "handled" && !input.terminalReason) throw new Error("attempt_terminal_reason_required");
		this.db
			.prepare(
				"UPDATE invocation_attempts SET delivery_state = ?, terminal_reason = ?, ended_at = ?, settlement = CASE WHEN settlement = 'streaming' THEN 'response_pending' ELSE settlement END WHERE attempt_id = ?",
			)
			.run(mapped, mapped === "handled" ? null : input.terminalReason, input.endedAt, attemptId);
		return { outcome: "transitioned" };
	}

	/** Prestart terminal: queued→failed(target_invalid)|canceled, starting→failed|canceled. */
	markPrestartTerminal(
		attemptId: string,
		input: { status: "failed" | "canceled"; terminalReason: string; endedAt: number },
	): InvocationAttempt | null {
		const current = this.get(attemptId);
		if (!current) return null;
		if (
			current.deliveryState === "queued" &&
			input.status === "failed" &&
			input.terminalReason !== "target_invalid"
		) {
			throw new Error("attempt_queued_failed_requires_target_invalid");
		}
		this.db
			.prepare(
				"UPDATE invocation_attempts SET delivery_state = ?, terminal_reason = ?, ended_at = ? WHERE attempt_id = ? AND delivery_state IN ('queued', 'starting')",
			)
			.run(input.status, input.terminalReason, input.endedAt, attemptId);
		return this.get(attemptId);
	}

	recordUsage(attemptId: string, usage: Record<string, unknown>): InvocationAttempt | null {
		this.db
			.prepare("UPDATE invocation_attempts SET usage_json = ? WHERE attempt_id = ?")
			.run(JSON.stringify(usage), attemptId);
		return this.get(attemptId);
	}

	listActive(): InvocationAttempt[] {
		const rows = this.db
			.prepare("SELECT * FROM invocation_attempts WHERE delivery_state IN ('starting', 'appended')")
			.all() as unknown as AttemptRow[];
		return rows.map(mapAttempt);
	}

	listResponsePending(): InvocationAttempt[] {
		const rows = this.db
			.prepare("SELECT * FROM invocation_attempts WHERE settlement = 'response_pending'")
			.all() as unknown as AttemptRow[];
		return rows.map(mapAttempt);
	}
}
