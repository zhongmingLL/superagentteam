import type { DatabaseSync } from "node:sqlite";
import type { InvocationRecord, InvocationRecordStatus } from "@superagentteam/shared/types";

// ------------------------------------------------------------ records (§3.2)

interface RecordRow {
	invocation_id: string;
	thread_id: string;
	user_id: string;
	source_record_id: string;
	user_message_id: string | null;
	target_agent_ids_json: string;
	status: InvocationRecordStatus;
	successful_agent_ids_json: string;
	usage_by_agent_json: string;
	usage_recorded_at: number | null;
	retry_count: number;
	terminal_reason: string | null;
	created_at: number;
	started_at: number | null;
	ended_at: number | null;
}

function mapRecord(row: RecordRow): InvocationRecord {
	return {
		invocationId: row.invocation_id,
		threadId: row.thread_id,
		userId: row.user_id,
		sourceRecordId: row.source_record_id,
		userMessageId: row.user_message_id,
		targetAgentIds: JSON.parse(row.target_agent_ids_json) as string[],
		status: row.status,
		successfulAgentIds: JSON.parse(row.successful_agent_ids_json) as string[],
		usageByAgent: JSON.parse(row.usage_by_agent_json) as Record<string, unknown>,
		usageRecordedAt: row.usage_recorded_at,
		retryCount: row.retry_count,
		terminalReason: row.terminal_reason,
		createdAt: row.created_at,
		startedAt: row.started_at,
		endedAt: row.ended_at,
	};
}

export type TerminalStatus = Exclude<InvocationRecordStatus, "queued" | "running">;

export interface CreateInvocationRecordInput {
	invocationId: string;
	threadId: string;
	userId: string;
	sourceRecordId: string;
	userMessageId: string | null;
	targetAgentIds: string[];
	now: number;
}

export class InvocationRecordStore {
	private readonly db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.db = db;
	}

	/**
	 * Three-state create (0011 §11 + R-01): owner must match thread owner;
	 * replay compares immutable inputs; drift fails closed.
	 */
	create(input: CreateInvocationRecordInput): {
		outcome: "created" | "replayed" | "conflict";
		record: InvocationRecord;
	} {
		const thread = this.db.prepare("SELECT created_by FROM threads WHERE id = ?").get(input.threadId) as
			| { created_by: string }
			| undefined;
		if (!thread) throw new Error("invocation_thread_not_found");
		if (thread.created_by !== input.userId) throw new Error("invocation_owner_not_thread_owner");
		const existing = this.byThreadSource(input.threadId, input.sourceRecordId);
		if (existing) {
			const sameIdentity =
				existing.userId === input.userId &&
				existing.targetAgentIds.join("\u0000") === input.targetAgentIds.join("\u0000") &&
				(existing.userMessageId ?? null) === (input.userMessageId ?? null);
			if (!sameIdentity) return { outcome: "conflict", record: existing };
			return { outcome: "replayed", record: existing };
		}
		if (input.targetAgentIds.length === 0) throw new Error("invocation_targets_empty");
		this.db
			.prepare(
				`INSERT INTO invocation_records (invocation_id, thread_id, user_id, source_record_id, user_message_id, target_agent_ids_json, status, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)`,
			)
			.run(
				input.invocationId,
				input.threadId,
				input.userId,
				input.sourceRecordId,
				input.userMessageId,
				JSON.stringify(input.targetAgentIds),
				input.now,
			);
		return { outcome: "created", record: this.byThreadSource(input.threadId, input.sourceRecordId)! };
	}

	get(invocationId: string): InvocationRecord | null {
		const row = this.db.prepare("SELECT * FROM invocation_records WHERE invocation_id = ?").get(invocationId) as
			| RecordRow
			| undefined;
		return row ? mapRecord(row) : null;
	}

	byThreadSource(threadId: string, sourceRecordId: string): InvocationRecord | null {
		const row = this.db
			.prepare("SELECT * FROM invocation_records WHERE thread_id = ? AND source_record_id = ?")
			.get(threadId, sourceRecordId) as RecordRow | undefined;
		return row ? mapRecord(row) : null;
	}

	/**
	 * Claim-time status flip (G-02). Idempotent on running (returns the
	 * record); terminal or missing returns null so callers distinguish
	 * replay from failure.
	 */
	markRunning(invocationId: string, now: number): InvocationRecord | null {
		const current = this.get(invocationId);
		if (!current) return null;
		if (current.status === "running") return current;
		if (current.status !== "queued") return null;
		this.db
			.prepare(
				"UPDATE invocation_records SET status = 'running', started_at = COALESCE(started_at, ?) WHERE invocation_id = ? AND status = 'queued'",
			)
			.run(now, invocationId);
		return this.get(invocationId);
	}

	/** Monotonic union of successful agents (§3.9 aggregate rule). */
	addSuccessfulAgents(invocationId: string, agentIds: string[]): void {
		const row = this.get(invocationId);
		if (!row) return;
		const merged = [...new Set([...row.successfulAgentIds, ...agentIds])];
		if (merged.length === row.successfulAgentIds.length) return;
		this.db
			.prepare("UPDATE invocation_records SET successful_agent_ids_json = ? WHERE invocation_id = ?")
			.run(JSON.stringify(merged), invocationId);
	}

	setTerminal(invocationId: string, status: TerminalStatus, terminalReason: string | null, now: number): boolean {
		if (status !== "completed" && status !== "canceled" && !terminalReason) {
			throw new Error("invocation_terminal_reason_required");
		}
		const current = this.get(invocationId);
		if (!current) return false;
		// §5.1: queued → canceled only; every other terminal comes from running.
		if (current.status === "queued" && status !== "canceled") {
			throw new Error(`invocation_illegal_terminal_transition: queued -> ${status}`);
		}
		if (current.status !== "queued" && current.status !== "running") return false;
		return (
			this.db
				.prepare(
					"UPDATE invocation_records SET status = ?, terminal_reason = ?, ended_at = ? WHERE invocation_id = ? AND status IN ('queued', 'running')",
				)
				.run(status, status === "completed" ? null : terminalReason, now, invocationId).changes > 0
		);
	}

	/**
	 * T3 aggregate write (0007 §3.9): only queued|running parents;
	 * successfulAgentIds ⊆ targetAgentIds and monotonic; usage bucket first
	 * write only (usageRecordedAt stable).
	 */
	applyTerminalAggregate(input: {
		invocationId: string;
		status: TerminalStatus;
		successfulAgentIds: string[];
		terminalReason: string | null;
		usageByAgent?: Record<string, unknown>;
		now: number;
	}): boolean {
		const row = this.get(input.invocationId);
		if (!row) throw new Error("invocation_not_found");
		if (row.status !== "queued" && row.status !== "running") return false;
		// §5.1: queued → canceled only; every other terminal comes from running.
		if (row.status === "queued" && input.status !== "canceled") {
			throw new Error(`invocation_illegal_terminal_transition: queued -> ${input.status}`);
		}
		const outside = input.successfulAgentIds.filter((a) => !row.targetAgentIds.includes(a));
		if (outside.length > 0) throw new Error("invocation_successful_outside_targets");
		if (input.status !== "completed" && input.status !== "canceled" && !input.terminalReason) {
			throw new Error("invocation_terminal_reason_required");
		}
		const merged = [...new Set([...row.successfulAgentIds, ...input.successfulAgentIds])];
		const usage = row.usageRecordedAt === null && input.usageByAgent ? JSON.stringify(input.usageByAgent) : null;
		this.db
			.prepare(
				"UPDATE invocation_records SET status = ?, successful_agent_ids_json = ?, terminal_reason = ?, ended_at = ?, usage_by_agent_json = COALESCE(?, usage_by_agent_json), usage_recorded_at = COALESCE(usage_recorded_at, ?) WHERE invocation_id = ?",
			)
			.run(
				input.status,
				JSON.stringify(merged),
				input.status === "completed" ? null : input.terminalReason,
				input.now,
				usage,
				input.usageByAgent ? input.now : null,
				input.invocationId,
			);
		return true;
	}

	/**
	 * §3.9 abandon: failed/partial_failed → canceled(operator_abandon).
	 * The ONLY legal terminal→terminal transition (operator action).
	 */
	abandon(invocationId: string, reason: string, now: number): boolean {
		return (
			this.db
				.prepare(
					"UPDATE invocation_records SET status = 'canceled', terminal_reason = ?, ended_at = ? WHERE invocation_id = ? AND status IN ('failed', 'partial_failed')",
				)
				.run(reason, now, invocationId).changes > 0
		);
	}

	/** requestRetry store-side state flip only (§3.9 API boundary). */
	admitRetry(invocationId: string): boolean {
		return (
			this.db
				.prepare(
					"UPDATE invocation_records SET status = 'queued', retry_count = retry_count + 1, ended_at = NULL, terminal_reason = NULL WHERE invocation_id = ? AND status IN ('failed', 'partial_failed')",
				)
				.run(invocationId).changes > 0
		);
	}
}
