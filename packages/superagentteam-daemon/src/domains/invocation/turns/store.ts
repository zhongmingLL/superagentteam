import type { DatabaseSync } from "node:sqlite";
import type { TurnExecution, TurnExecutionStatus } from "@superagentteam/shared/types";
import { canonicalJson } from "../canonical.ts";

// -------------------------------------------------------- turns (§3.6/§4.3)

interface TurnRow {
	turn_execution_id: string;
	parent_invocation_id: string;
	thread_id: string;
	user_id: string;
	agent_id: string;
	execution_kind: "ordinary" | "routing_guard";
	causal_json: string;
	status: TurnExecutionStatus;
	terminal_reason: string | null;
	started_at: number;
	ended_at: number | null;
}

function mapTurn(row: TurnRow): TurnExecution {
	return {
		turnExecutionId: row.turn_execution_id,
		parentInvocationId: row.parent_invocation_id,
		threadId: row.thread_id,
		userId: row.user_id,
		agentId: row.agent_id,
		executionKind: row.execution_kind,
		causal: JSON.parse(row.causal_json) as TurnExecution["causal"],
		status: row.status,
		terminalReason: row.terminal_reason,
		startedAt: row.started_at,
		endedAt: row.ended_at,
	};
}

export interface CreateTurnExecutionInput {
	turnExecutionId: string;
	parentInvocationId: string;
	threadId: string;
	userId: string;
	agentId: string;
	executionKind: "ordinary" | "routing_guard";
	causal: TurnExecution["causal"];
	startedAt: number;
}

export type CreateTurnOutcome = "created" | "replayed" | "conflict";

export interface CreateTurnExecutionResult {
	outcome: CreateTurnOutcome;
	record: TurnExecution;
}

export interface TurnTerminalInput {
	status: Exclude<TurnExecutionStatus, "running">;
	endedAt: number;
	terminalReason?: string | null;
}

export class TurnExecutionStore {
	private readonly db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.db = db;
	}

	/**
	 * Provider 前幂等入口（§3.6）：identity = 全字段（startedAt 不进 identity）。
	 * replayed 不授予第二次 provider lease；identity 不同 = conflict。
	 */
	createRunning(input: CreateTurnExecutionInput): CreateTurnExecutionResult {
		// Ownership (0011 §11): userId must equal the parent/thread owner and
		// threadId must equal the parent's thread; agentId must be a target.
		const parent = this.db
			.prepare("SELECT thread_id, user_id, target_agent_ids_json FROM invocation_records WHERE invocation_id = ?")
			.get(input.parentInvocationId) as
			| { thread_id: string; user_id: string; target_agent_ids_json: string }
			| undefined;
		if (!parent) throw new Error("turn_parent_not_found");
		if (parent.thread_id !== input.threadId) throw new Error("turn_thread_not_parent_thread");
		if (parent.user_id !== input.userId) throw new Error("turn_user_not_parent_owner");
		const parentTargets = JSON.parse(parent.target_agent_ids_json) as string[];
		if (!parentTargets.includes(input.agentId)) throw new Error("turn_agent_not_parent_target");
		const existing = this.get(input.turnExecutionId);
		if (existing) {
			const sameIdentity =
				existing.parentInvocationId === input.parentInvocationId &&
				existing.threadId === input.threadId &&
				existing.userId === input.userId &&
				existing.agentId === input.agentId &&
				existing.executionKind === input.executionKind &&
				canonicalJson(existing.causal) === canonicalJson(input.causal);
			if (!sameIdentity) throw new Error("turn_identity_conflict");
			return { outcome: "replayed", record: existing };
		}
		this.db
			.prepare(
				`INSERT INTO turn_executions (turn_execution_id, parent_invocation_id, thread_id, user_id, agent_id, execution_kind, causal_json, status, started_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?)`,
			)
			.run(
				input.turnExecutionId,
				input.parentInvocationId,
				input.threadId,
				input.userId,
				input.agentId,
				input.executionKind,
				JSON.stringify(input.causal),
				input.startedAt,
			);
		return { outcome: "created", record: this.get(input.turnExecutionId)! };
	}

	get(turnExecutionId: string): TurnExecution | null {
		const row = this.db.prepare("SELECT * FROM turn_executions WHERE turn_execution_id = ?").get(turnExecutionId) as
			| TurnRow
			| undefined;
		return row ? mapTurn(row) : null;
	}

	listByInvocation(invocationId: string): TurnExecution[] {
		const rows = this.db
			.prepare("SELECT * FROM turn_executions WHERE parent_invocation_id = ?")
			.all(invocationId) as unknown as TurnRow[];
		return rows.map(mapTurn);
	}

	listRunning(): TurnExecution[] {
		const rows = this.db
			.prepare("SELECT * FROM turn_executions WHERE status = 'running'")
			.all() as unknown as TurnRow[];
		return rows.map(mapTurn);
	}

	/** Terminal first-write-wins; same status idempotent, different = conflict. */
	transitionTerminal(
		turnExecutionId: string,
		input: TurnTerminalInput,
	): { outcome: "transitioned" | "already_terminal" | "conflict" | "not_found" } {
		const row = this.get(turnExecutionId);
		if (!row) return { outcome: "not_found" };
		if (row.status !== "running") {
			return row.status === input.status ? { outcome: "already_terminal" } : { outcome: "conflict" };
		}
		if (input.status !== "completed" && !input.terminalReason) {
			throw new Error("turn_terminal_reason_required");
		}
		if (input.endedAt < row.startedAt) throw new Error("turn_ended_before_started");
		const changes = this.db
			.prepare(
				"UPDATE turn_executions SET status = ?, terminal_reason = ?, ended_at = ? WHERE turn_execution_id = ? AND status = 'running'",
			)
			.run(
				input.status,
				input.status === "completed" ? null : (input.terminalReason ?? null),
				input.endedAt,
				turnExecutionId,
			).changes;
		return changes > 0 ? { outcome: "transitioned" } : { outcome: "conflict" };
	}

	/** Startup-only cutoff convergence (§3.10.1). */
	interruptRunningBefore(
		cutoffStartedAt: number,
		input: { endedAt: number; terminalReason: string; excludedTurnExecutionIds?: readonly string[] },
	): TurnExecution[] {
		const excluded = new Set(input.excludedTurnExecutionIds ?? []);
		const rows = this.db
			.prepare("SELECT * FROM turn_executions WHERE status = 'running' AND started_at < ?")
			.all(cutoffStartedAt) as unknown as TurnRow[];
		const converged: TurnExecution[] = [];
		for (const row of rows) {
			if (excluded.has(row.turn_execution_id)) continue;
			this.db
				.prepare(
					"UPDATE turn_executions SET status = 'interrupted', terminal_reason = ?, ended_at = ? WHERE turn_execution_id = ? AND status = 'running'",
				)
				.run(input.terminalReason, input.endedAt, row.turn_execution_id).changes;
			if (row.status === "running") converged.push(this.get(row.turn_execution_id)!);
		}
		return converged;
	}

	/** attempt settlement projection (0007 §3.6): join over attempts. */
	listResponsePending(): TurnExecution[] {
		const rows = this.db
			.prepare(
				`SELECT t.* FROM turn_executions t JOIN invocation_attempts a ON a.turn_execution_id = t.turn_execution_id
				 WHERE a.settlement = 'response_pending'`,
			)
			.all() as unknown as TurnRow[];
		return rows.map(mapTurn);
	}

	clearResponsePending(turnExecutionId: string): {
		outcome: "settled" | "already_settled" | "not_pending" | "not_found";
	} {
		const changes = this.db
			.prepare(
				"UPDATE invocation_attempts SET settlement = 'settled' WHERE turn_execution_id = ? AND settlement = 'response_pending'",
			)
			.run(turnExecutionId).changes;
		if (changes > 0) return { outcome: "settled" };
		const row = this.db
			.prepare("SELECT settlement FROM invocation_attempts WHERE turn_execution_id = ?")
			.get(turnExecutionId) as { settlement: string | null } | undefined;
		if (!row) return { outcome: "not_found" };
		return row.settlement === null || row.settlement === "streaming"
			? { outcome: "not_pending" }
			: { outcome: "already_settled" };
	}
}
