import { create } from "zustand";

import { type AccountView, type AgentApi, type AgentView, agentApi, type CreateAgentInput } from "./api.ts";

export type AgentListStatus = "idle" | "loading" | "ready" | "error";

export interface AgentState {
	agents: AgentView[];
	status: AgentListStatus;
	error?: string;
	accounts: AccountView[];
	accountsStatus: AgentListStatus;
	accountsError?: string;
	load(): Promise<void>;
	refresh(): Promise<boolean>;
	loadAccounts(): Promise<void>;
	create(input: CreateAgentInput): Promise<AgentView>;
}

export interface AgentStoreDeps {
	api: Pick<AgentApi, "list" | "accounts" | "create">;
}

function messageOf(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
}

export function createAgentStore(deps: AgentStoreDeps) {
	return create<AgentState>((set, get) => ({
		agents: [],
		status: "idle",
		error: undefined,
		accounts: [],
		accountsStatus: "idle",
		accountsError: undefined,

		async load() {
			set({ status: "loading", error: undefined });
			try {
				const body = await deps.api.list();
				set({ agents: body.agents, status: "ready", error: undefined });
			} catch (error) {
				set({ status: "error", error: messageOf(error, "无法加载 agents") });
			}
		},

		async refresh() {
			try {
				const body = await deps.api.list();
				set({ agents: body.agents, status: "ready", error: undefined });
				return true;
			} catch (error) {
				set({
					status: get().agents.length === 0 ? "error" : "ready",
					error: messageOf(error, "无法加载 agents"),
				});
				return false;
			}
		},

		async loadAccounts() {
			set({ accountsStatus: "loading", accountsError: undefined });
			try {
				const body = await deps.api.accounts();
				set({ accounts: body.accounts, accountsStatus: "ready", accountsError: undefined });
			} catch (error) {
				set({
					accountsStatus: get().accounts.length === 0 ? "error" : "ready",
					accountsError: messageOf(error, "无法加载 accounts"),
				});
			}
		},

		async create(input) {
			const body = await deps.api.create(input);
			await get().refresh();
			return body.agent;
		},
	}));
}

export const useAgentStore = createAgentStore({ api: agentApi });
