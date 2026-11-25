import { api } from "@/lib/api";
import type { ApiClient } from "@/lib/api/client.ts";

export interface AccountProviderView {
	id: string;
	label: string;
	envName: string;
	supportsBaseUrl: boolean;
	suggestedModels: string[];
}

export type AccountCredentialKind = "stored" | "env" | "none";

export interface AccountCredentialView {
	kind: AccountCredentialKind;
	envName?: string;
}

export interface AccountView {
	ref: string;
	displayName?: string;
	provider: string;
	providerLabel: string;
	apiUrl?: string;
	models: string[];
	credential: AccountCredentialView;
	boundAgentIds: string[];
}

export interface AccountInput {
	ref?: string;
	displayName?: string;
	provider: string;
	apiUrl?: string;
	models: string[];
	apiKey?: string;
	envName?: string;
}

export interface AccountApi {
	list(): Promise<{ accounts: AccountView[] }>;
	providers(): Promise<{ providers: AccountProviderView[] }>;
	create(input: AccountInput): Promise<{ account: AccountView }>;
	update(ref: string, input: AccountInput): Promise<{ account: AccountView }>;
	remove(ref: string): Promise<{ ok: true }>;
}

export function createAccountApi(client: Pick<ApiClient, "get" | "post" | "request">): AccountApi {
	return {
		list: () => client.get<{ accounts: AccountView[] }>("/api/accounts"),
		providers: () => client.get<{ providers: AccountProviderView[] }>("/api/providers"),
		create: (input) => client.post<{ account: AccountView }>("/api/accounts", input),
		update: (ref, input) =>
			client.request<{ account: AccountView }>(`/api/accounts/${encodeURIComponent(ref)}`, {
				method: "PATCH",
				body: JSON.stringify(input),
			}),
		remove: (ref) => client.request<{ ok: true }>(`/api/accounts/${encodeURIComponent(ref)}`, { method: "DELETE" }),
	};
}

export const accountApi = createAccountApi(api);
