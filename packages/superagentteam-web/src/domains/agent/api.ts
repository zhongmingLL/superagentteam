import { api } from "@/lib/api";
import type { ApiClient } from "@/lib/api/client.ts";
import type { AccountView } from "@/domains/account/api";

export type AgentStatus = "idle" | "thinking" | "working" | "error" | "offline";

export interface AgentView {
	id: string;
	displayName: string;
	avatar?: string;
	color?: { primary: string; secondary: string };
	enabled: boolean;
	status?: AgentStatus;
	accountRef?: string;
	defaultModel?: string;
	mentionPatterns?: string[];
	roleId?: string;
	roleDescription?: string;
}

export type { AccountView } from "@/domains/account/api";

export interface CreateAgentInput {
	id: string;
	displayName: string;
	mentionPatterns: string[];
	accountRef: string;
	defaultModel: string;
	roleId: string;
	roleDescription?: string;
	enabled?: boolean;
}

export interface UpdateAgentInput {
	displayName?: string;
	mentionPatterns?: string[];
	accountRef?: string;
	defaultModel?: string;
	roleId?: string;
	roleDescription?: string;
	enabled?: boolean;
}

export interface AgentApi {
	list(): Promise<{ agents: AgentView[] }>;
	accounts(): Promise<{ accounts: AccountView[] }>;
	create(input: CreateAgentInput): Promise<{ agent: AgentView }>;
	update(id: string, input: UpdateAgentInput): Promise<{ agent: AgentView }>;
}

export function createAgentApi(client: Pick<ApiClient, "get" | "post" | "request">): AgentApi {
	return {
		list: () => client.get<{ agents: AgentView[] }>("/api/agents"),
		accounts: () => client.get<{ accounts: AccountView[] }>("/api/accounts"),
		create: (input) => client.post<{ agent: AgentView }>("/api/agents", input),
		update: (id, input) =>
			client.request<{ agent: AgentView }>(`/api/agents/${encodeURIComponent(id)}`, {
				method: "PATCH",
				body: JSON.stringify(input),
			}),
	};
}

export const agentApi = createAgentApi(api);
