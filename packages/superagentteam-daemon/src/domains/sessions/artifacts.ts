import type { DatabaseSync } from "node:sqlite";

import type { SessionArtifactView, SessionDigestV1, SessionTranscriptEntry } from "@superagentteam/shared/types";

interface ArtifactRow {
	session_id: string;
	thread_id: string;
	agent_id: string;
	seq: number;
	sealed_at: number;
	seal_reason: string;
	from_seq: number;
	to_seq: number;
	message_count: number;
	transcript_bytes: number;
	digest_json: string;
	transcript_json: string;
	created_at: number;
}

function mapArtifact(row: ArtifactRow): SessionArtifactView {
	return {
		sessionId: row.session_id,
		threadId: row.thread_id,
		agentId: row.agent_id,
		seq: row.seq,
		sealedAt: row.sealed_at,
		sealReason: row.seal_reason,
		fromSeq: row.from_seq,
		toSeq: row.to_seq,
		messageCount: row.message_count,
		transcriptBytes: row.transcript_bytes,
		createdAt: row.created_at,
		digest: JSON.parse(row.digest_json) as SessionDigestV1,
		transcript: JSON.parse(row.transcript_json) as SessionTranscriptEntry[],
	};
}

export interface CreateSessionArtifactInput {
	sessionId: string;
	threadId: string;
	agentId: string;
	seq: number;
	sealedAt: number;
	sealReason: string;
	fromSeq: number;
	toSeq: number;
	messageCount: number;
	transcriptBytes: number;
	digest: SessionDigestV1;
	transcript: SessionTranscriptEntry[];
	createdAt: number;
}

export class SessionArtifactStore {
	private readonly db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.db = db;
	}

	create(input: CreateSessionArtifactInput): SessionArtifactView {
		this.db
			.prepare(
				`INSERT INTO session_artifacts
				 (session_id, thread_id, agent_id, seq, sealed_at, seal_reason, from_seq, to_seq,
				  message_count, transcript_bytes, digest_json, transcript_json, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				input.sessionId,
				input.threadId,
				input.agentId,
				input.seq,
				input.sealedAt,
				input.sealReason,
				input.fromSeq,
				input.toSeq,
				input.messageCount,
				input.transcriptBytes,
				JSON.stringify(input.digest),
				JSON.stringify(input.transcript),
				input.createdAt,
			);
		return this.get(input.sessionId)!;
	}

	get(sessionId: string): SessionArtifactView | null {
		const row = this.db.prepare("SELECT * FROM session_artifacts WHERE session_id = ?").get(sessionId) as
			| ArtifactRow
			| undefined;
		return row ? mapArtifact(row) : null;
	}

	getByThread(threadId: string, agentId?: string): SessionArtifactView[] {
		const rows = (agentId === undefined
			? this.db.prepare("SELECT * FROM session_artifacts WHERE thread_id = ? ORDER BY agent_id, seq").all(threadId)
			: this.db
					.prepare("SELECT * FROM session_artifacts WHERE thread_id = ? AND agent_id = ? ORDER BY seq")
					.all(threadId, agentId)) as unknown as ArtifactRow[];
		return rows.map(mapArtifact);
	}

	/** Highest captured seq for the agent's chain; null when no artifact exists. */
	latestToSeq(threadId: string, agentId: string): number | null {
		const row = this.db
			.prepare("SELECT MAX(to_seq) AS seq FROM session_artifacts WHERE thread_id = ? AND agent_id = ?")
			.get(threadId, agentId) as { seq: number | null } | undefined;
		return row?.seq ?? null;
	}

	has(sessionId: string): boolean {
		return (
			(this.db.prepare("SELECT 1 AS present FROM session_artifacts WHERE session_id = ?").get(sessionId) as
				| { present: number }
				| undefined) !== undefined
		);
	}
}
