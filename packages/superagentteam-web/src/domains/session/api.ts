import type {
	AgentSession,
	SessionArtifactView,
	SessionChainItem,
	SessionTranscriptEntry,
} from "@superagentteam/shared/types";

import { api } from "@/lib/api";
import type { ApiClient } from "@/lib/api/client.ts";

export interface SessionChainResponse {
	threadId: string;
	sessions: SessionChainItem[];
}

export interface SessionDetailResponse {
	session: AgentSession;
	artifact: SessionArtifactView | null;
}

export interface SessionTranscriptResponse {
	session: AgentSession;
	artifact: SessionArtifactView;
	transcript: SessionTranscriptEntry[];
}

export interface SessionSealResponse {
	session: AgentSession;
	artifact: SessionArtifactView;
}

export interface SessionApi {
	chain(threadId: string): Promise<SessionChainResponse>;
	detail(sessionId: string): Promise<SessionDetailResponse>;
	transcript(sessionId: string): Promise<SessionTranscriptResponse>;
	seal(sessionId: string, reason?: string): Promise<SessionSealResponse>;
}

export function createSessionApi(client: Pick<ApiClient, "get" | "post">): SessionApi {
	return {
		chain: (threadId) => client.get<SessionChainResponse>(`/api/threads/${encodeURIComponent(threadId)}/sessions`),
		detail: (sessionId) => client.get<SessionDetailResponse>(`/api/sessions/${encodeURIComponent(sessionId)}`),
		transcript: (sessionId) =>
			client.get<SessionTranscriptResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/transcript`),
		seal: (sessionId, reason = "manual") =>
			client.post<SessionSealResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/seal`, { reason }),
	};
}

export const sessionApi = createSessionApi(api);
