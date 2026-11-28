import type { DatabaseSync } from "node:sqlite";

import type {
	AgentSession,
	SessionArtifactView,
	SessionChainItem,
	SessionTranscriptEntry,
} from "@superagentteam/shared/types";

import { runInTransaction } from "../../infrastructure/db/database.ts";
import { disabledRuntimeTelemetry, type RuntimeTelemetry } from "../../observability/runtime-telemetry.ts";
import { BOOTSTRAP_WINDOW } from "../context/assembler.ts";
import type { AgentReadStateStore, MessageStore } from "../messages/store.ts";
import type { QueueLedgerStore } from "../queue/ledger/store.ts";
import type { InvocationTracker } from "../queue/tracker/index.ts";
import type { ThreadStore } from "../threads/store.ts";
import type { SessionArtifactStore } from "./artifacts.ts";
import type { AgentSessionStore } from "./store.ts";
import { buildSessionDigest, buildSessionTranscript, MAX_TRANSCRIPT_MESSAGES } from "./transcript.ts";

// F054: manual full seal + session-chain read model.
//
// The lifecycle truth stays agent_sessions. A seal writes one immutable
// session_artifacts row (bounded transcript + deterministic digest) and moves
// active -> sealed in the same transaction; the next invocation creates seq+1
// through the existing AgentSessionStore.ensureActive path.

export type SessionSealErrorCode =
	| "thread_not_found"
	| "forbidden"
	| "session_not_found"
	| "session_not_active"
	| "session_active_invocation"
	| "session_busy"
	| "session_artifact_exists"
	| "session_artifact_not_found"
	| "session_seal_conflict";

export type SessionSealRejected = { outcome: "rejected"; code: SessionSealErrorCode; message: string };

export interface SessionSealServiceDeps {
	db: DatabaseSync;
	threads: ThreadStore;
	sessions: AgentSessionStore;
	artifacts: SessionArtifactStore;
	messages: MessageStore;
	readState: AgentReadStateStore;
	tracker: InvocationTracker;
	queue: QueueLedgerStore;
	telemetry?: RuntimeTelemetry;
	clock?: () => number;
}

export interface SessionChainResult {
	threadId: string;
	sessions: SessionChainItem[];
}

export interface SessionDetailResult {
	session: AgentSession;
	artifact: SessionArtifactView | null;
}

export interface SessionTranscriptResult {
	session: AgentSession;
	artifact: SessionArtifactView;
	transcript: SessionTranscriptEntry[];
}

export type SessionSealSuccess = {
	outcome: "sealed";
	session: AgentSession;
	artifact: SessionArtifactView;
};

export class SessionSealService {
	private readonly deps: SessionSealServiceDeps;
	private readonly clock: () => number;
	private readonly telemetry: RuntimeTelemetry;

	constructor(deps: SessionSealServiceDeps) {
		this.deps = deps;
		this.clock = deps.clock ?? Date.now;
		this.telemetry = deps.telemetry ?? disabledRuntimeTelemetry("session_seal");
	}

	chain(threadId: string, userId: string, agentId?: string): SessionChainResult | SessionSealRejected {
		const thread = this.deps.threads.get(threadId);
		if (!thread || (thread.deletedAt !== null && thread.deletedAt !== undefined)) {
			return reject("thread_not_found", `thread ${threadId} not found`);
		}
		if (thread.createdBy !== userId) {
			return reject("forbidden", `thread ${threadId} belongs to another user`);
		}
		const artifactIds = new Set(this.deps.artifacts.getByThread(threadId, agentId).map((item) => item.sessionId));
		const sessions = this.deps.sessions
			.listByThread(threadId, agentId)
			.map((session) => ({ ...session, hasArtifact: artifactIds.has(session.id) }));
		return { threadId, sessions };
	}

	detail(sessionId: string, userId: string): SessionDetailResult | SessionSealRejected {
		const authorized = this.authorize(sessionId, userId);
		if ("outcome" in authorized) return authorized;
		return {
			session: authorized.session,
			artifact: this.deps.artifacts.get(sessionId),
		};
	}

	transcript(sessionId: string, userId: string): SessionTranscriptResult | SessionSealRejected {
		const authorized = this.authorize(sessionId, userId);
		if ("outcome" in authorized) return authorized;
		const artifact = this.deps.artifacts.get(sessionId);
		if (!artifact) {
			return reject("session_artifact_not_found", `session ${sessionId} has no sealed transcript`);
		}
		return { session: authorized.session, artifact, transcript: artifact.transcript };
	}

	seal(sessionId: string, userId: string, reason = "manual"): SessionSealSuccess | SessionSealRejected {
		const existing = this.deps.sessions.get(sessionId);
		const span = this.telemetry.startSpan("superagentteam.session.seal", {
			"thread.id": existing?.threadId ?? "unknown",
			"user.id": userId,
			"agent.id": existing?.agentId ?? "unknown",
			"session.id": sessionId,
			"seal.reason": reason,
		});
		try {
			const result = this.sealInner(sessionId, userId, reason);
			if (result.outcome === "sealed") {
				span?.setAttribute("message.count", result.artifact.messageCount);
				span?.setAttribute("transcript.bytes", result.artifact.transcriptBytes);
				span?.setStatus("ok");
				this.telemetry.recordSeal(result.session.sealReason ?? reason);
			} else {
				span?.setStatus("error", "seal_rejected");
				this.telemetry.recordError("seal", result.code);
			}
			return result;
		} catch (error) {
			span?.setStatus("error", "seal_exception");
			this.telemetry.recordError("seal", "exception");
			throw error;
		} finally {
			span?.end();
		}
	}

	private sealInner(sessionId: string, userId: string, reason: string): SessionSealSuccess | SessionSealRejected {
		const authorized = this.authorize(sessionId, userId);
		if ("outcome" in authorized) return authorized;
		const { session } = authorized;
		if (session.status !== "active") {
			return reject("session_not_active", `session ${sessionId} is ${session.status}`);
		}
		if (this.deps.tracker.has(session.threadId, session.agentId)) {
			return reject("session_active_invocation", "stop the agent before sealing its session");
		}
		if (this.hasQueuedWork(session.threadId, session.agentId)) {
			return reject("session_busy", "the agent still has queued work in this thread");
		}

		const now = this.clock();
		const sealReason = normalizeReason(reason);
		const fromSeq = (this.deps.artifacts.latestToSeq(session.threadId, session.agentId) ?? 0) + 1;
		const tailSeq = this.deps.messages.latestSeq(session.threadId);
		const toSeq = Math.max(tailSeq, fromSeq);
		const fetched = this.deps.messages.getByThreadRangeRecent(
			session.threadId,
			fromSeq,
			toSeq,
			MAX_TRANSCRIPT_MESSAGES + 1,
		);
		const truncated = fetched.length > MAX_TRANSCRIPT_MESSAGES;
		const window = truncated ? fetched.slice(fetched.length - MAX_TRANSCRIPT_MESSAGES) : fetched;
		const transcript = buildSessionTranscript(window, fromSeq, truncated);
		const digest = buildSessionDigest({
			session,
			entries: transcript.transcript,
			fromSeq: transcript.fromSeq,
			toSeq: transcript.toSeq,
			sealedAt: now,
			sealReason,
			truncated,
		});

		try {
			const sealed = runInTransaction(this.deps.db, () => {
				const fresh = this.deps.sessions.get(sessionId);
				if (!fresh || fresh.status !== "active") throw new SealConflictError("session_not_active");
				if (this.deps.tracker.has(fresh.threadId, fresh.agentId)) {
					throw new SealConflictError("session_active_invocation");
				}
				if (this.hasQueuedWork(fresh.threadId, fresh.agentId)) {
					throw new SealConflictError("session_busy");
				}
				if (this.deps.artifacts.has(sessionId)) throw new SealConflictError("session_artifact_exists");
				const artifact = this.deps.artifacts.create({
					sessionId,
					threadId: fresh.threadId,
					agentId: fresh.agentId,
					seq: fresh.seq,
					sealedAt: now,
					sealReason,
					fromSeq: transcript.fromSeq,
					toSeq: transcript.toSeq,
					messageCount: transcript.messageCount,
					transcriptBytes: transcript.transcriptBytes,
					digest,
					transcript: transcript.transcript,
					createdAt: now,
				});
				const updated = this.deps.sessions.sealActive(sessionId, sealReason, now);
				if (!updated || updated.status !== "sealed") throw new SealConflictError("session_seal_conflict");
				// Chain continuity: the next active session must not start from an
				// empty cursor. Rewind to the bootstrap window (0010 reset semantics).
				this.deps.readState.rewind(
					fresh.threadId,
					fresh.agentId,
					Math.max(0, transcript.toSeq - BOOTSTRAP_WINDOW),
					now,
				);
				return { session: updated, artifact };
			});
			return { outcome: "sealed", ...sealed };
		} catch (error) {
			if (error instanceof SealConflictError) return reject(error.code, `seal rejected: ${error.code}`);
			if (
				error instanceof Error &&
				error.message.includes("UNIQUE constraint failed: session_artifacts.session_id")
			) {
				return reject("session_artifact_exists", "session already has a sealed artifact");
			}
			throw error;
		}
	}

	private authorize(sessionId: string, userId: string): { session: AgentSession } | SessionSealRejected {
		const session = this.deps.sessions.get(sessionId);
		if (!session) return reject("session_not_found", `session ${sessionId} not found`);
		const thread = this.deps.threads.get(session.threadId);
		if (!thread || (thread.deletedAt !== null && thread.deletedAt !== undefined)) {
			return reject("thread_not_found", `thread ${session.threadId} not found`);
		}
		if (thread.createdBy !== userId) {
			return reject("forbidden", `thread ${session.threadId} belongs to another user`);
		}
		return { session };
	}

	private hasQueuedWork(threadId: string, agentId: string): boolean {
		return [...this.deps.queue.listQueued(threadId), ...this.deps.queue.listActive(threadId)].some((entry) =>
			entry.targets.some((target) => target.kind === "agent" && target.id === agentId),
		);
	}
}

class SealConflictError extends Error {
	readonly code: SessionSealErrorCode;
	constructor(code: SessionSealErrorCode) {
		super(code);
		this.name = "SealConflictError";
		this.code = code;
	}
}

function normalizeReason(reason: string): string {
	const trimmed = reason.trim();
	return (trimmed.length > 0 ? trimmed : "manual").slice(0, 100);
}

function reject(code: SessionSealErrorCode, message: string): SessionSealRejected {
	return { outcome: "rejected", code, message };
}
