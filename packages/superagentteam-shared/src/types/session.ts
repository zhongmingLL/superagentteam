import type { AgentSession } from "./invocation.ts";

/** F054: one bounded transcript entry captured at seal time. */
export interface SessionTranscriptEntry {
	seq: number;
	at: number;
	from: { kind: "user" | "agent" | "system"; id: string };
	content: string;
	thinking?: string;
	toolEvents?: Array<{ name: string; status: "running" | "completed" }>;
	lifecycleKind?: "input" | "response" | "delivery_failure";
	lifecycleStatus?: "processing" | "completed" | "failed" | "interrupted" | "canceled";
	/** True when content/thinking was clipped for the artifact. */
	truncated?: boolean;
}

/** F054 deterministic extractive digest; no model call. */
export interface SessionDigestV1 {
	v: 1;
	sessionId: string;
	threadId: string;
	agentId: string;
	seq: number;
	createdAt: number;
	sealedAt: number;
	sealReason: string;
	window: {
		fromSeq: number;
		toSeq: number;
		messageCount: number;
		truncated: boolean;
	};
	senders: {
		user: number;
		agents: Record<string, number>;
		system: number;
	};
	tools: Array<{ name: string; count: number }>;
	errors: { count: number; samples: string[] };
	firstUserMessage?: string;
	lastUserMessage?: string;
	lastAgentMessage?: string;
	recent: Array<{ role: "user" | "agent" | "system"; label: string; content: string; at: number }>;
}

export interface SessionArtifactView {
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
	createdAt: number;
	digest: SessionDigestV1;
	transcript: SessionTranscriptEntry[];
}

export interface SessionChainItem extends AgentSession {
	hasArtifact: boolean;
}
