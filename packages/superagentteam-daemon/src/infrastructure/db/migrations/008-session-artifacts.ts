import type { ControlMigration } from "./index.ts";

/**
 * F054 full-seal artifacts (Clowder SessionSealer/TranscriptWriter subset).
 *
 * One row per sealed session: a bounded transcript window + deterministic
 * extractive digest. The session row keeps the lifecycle truth; this table is
 * the durable recall artifact and is never rewritten after seal.
 */
export const sessionArtifactsMigration: ControlMigration = {
	version: 8,
	name: "session-artifacts",
	up: [
		`CREATE TABLE session_artifacts (
			session_id TEXT PRIMARY KEY,
			thread_id TEXT NOT NULL,
			agent_id TEXT NOT NULL,
			seq INTEGER NOT NULL CHECK (seq >= 0),
			sealed_at INTEGER NOT NULL,
			seal_reason TEXT NOT NULL,
			from_seq INTEGER NOT NULL CHECK (from_seq >= 0),
			to_seq INTEGER NOT NULL CHECK (to_seq >= from_seq),
			message_count INTEGER NOT NULL CHECK (message_count >= 0),
			transcript_bytes INTEGER NOT NULL CHECK (transcript_bytes >= 0),
			digest_json TEXT NOT NULL CHECK (json_valid(digest_json) AND json_type(digest_json) = 'object'),
			transcript_json TEXT NOT NULL CHECK (json_valid(transcript_json) AND json_type(transcript_json) = 'array'),
			created_at INTEGER NOT NULL,
			FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE RESTRICT,
			FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE RESTRICT
		) STRICT`,
		`CREATE INDEX session_artifacts_chain ON session_artifacts(thread_id, agent_id, seq)`,
	],
	down: ["DROP INDEX session_artifacts_chain", "DROP TABLE session_artifacts"],
};
