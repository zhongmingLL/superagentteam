import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";

import type { AccountConfig, AgentConfig } from "@superagentteam/shared/types";

import { ACCOUNT_PROVIDERS, findAccountProvider } from "../../domains/account/providers.ts";
import { AccountError, AccountStore, type AccountView } from "../../domains/account/store.ts";
import {
	appendAgent,
	type CreateAgentInput,
	readCatalogFile,
	toAgentConfig,
	validateCandidate,
	writeCatalogAtomic,
} from "../../domains/agent/catalog-store.ts";
import { type AgentRegistry, CatalogError, type CatalogPaths, reloadRegistry } from "../../domains/agent/registry.ts";
import type { InvocationTracker } from "../../domains/queue/tracker.ts";
import { HttpError, readJsonBody, sendError, sendJson } from "../http.ts";
import { requireCsrf } from "../session.ts";
import type { ApiRouteContext } from "./context.ts";

export type AgentStatus = "idle" | "thinking" | "working" | "error" | "offline";

export interface AgentView {
	id: string;
	displayName: string;
	avatar?: string;
	color?: { primary: string; secondary: string };
	enabled: boolean;
	status?: AgentStatus;
}

export interface HubCatView extends AgentView {
	catId: string;
}

export interface AgentRoutes {
	handle(
		request: IncomingMessage,
		response: ServerResponse,
		url: URL,
		context: ApiRouteContext,
	): boolean | Promise<boolean>;
}

export interface AgentRoutesOptions {
	registry: AgentRegistry;
	tracker: InvocationTracker;
	catalogPath?: string;
	accountsPath?: string;
	credentialsPath?: string;
	clock?: () => number;
}

function toView(agent: AgentConfig, activeAgents: ReadonlySet<string>): AgentView {
	// Global summary only. Multi-thread busy state belongs to
	// GET /api/threads/:id/live; do not paint this as per-thread presence.
	const status: AgentStatus = !agent.enabled ? "offline" : activeAgents.has(agent.id) ? "working" : "idle";
	return {
		id: agent.id,
		displayName: agent.displayName,
		...(agent.avatar ? { avatar: agent.avatar } : {}),
		...(agent.color ? { color: { ...agent.color } } : {}),
		enabled: agent.enabled,
		status,
	};
}

interface ParsedCreate {
	ok: true;
	input: CreateAgentInput;
}

interface ParsedCreateError {
	ok: false;
	message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredString(body: Record<string, unknown>, key: string, maxLength: number): string | null {
	const value = body[key];
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (trimmed === "" || trimmed.length > maxLength) return null;
	return trimmed;
}

function readOptionalString(body: Record<string, unknown>, key: string, maxLength: number): string | null | undefined {
	const value = body[key];
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string" || value.length > maxLength) return null;
	return value;
}

function parseMentionPatterns(value: unknown): string[] | null {
	let raw: string[];
	if (typeof value === "string") {
		raw = value.split(/[\s,]+/u);
	} else if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
		raw = value as string[];
	} else {
		return null;
	}
	const patterns: string[] = [];
	for (const item of raw) {
		const trimmed = item.trim();
		if (trimmed === "" || trimmed.length > 64) continue;
		const pattern = trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
		if (!patterns.includes(pattern)) patterns.push(pattern);
	}
	if (patterns.length === 0 || patterns.length > 20) return null;
	return patterns;
}

function parseColor(value: unknown): { primary: string; secondary: string } | null | undefined {
	if (value === undefined || value === null) return undefined;
	if (!isRecord(value)) return null;
	const primary = value.primary;
	const secondary = value.secondary;
	if (typeof primary !== "string" || typeof secondary !== "string") return null;
	return { primary, secondary };
}

function parseCreateInput(body: Record<string, unknown>): ParsedCreate | ParsedCreateError {
	const id = readRequiredString(body, "id", 64);
	if (!id) return { ok: false, message: "id is required (1-64 chars)" };
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(id)) {
		return { ok: false, message: "id must start alphanumeric and contain only letters, digits, . _ : -" };
	}
	const displayName = readRequiredString(body, "displayName", 200);
	if (!displayName) return { ok: false, message: "displayName is required (1-200 chars)" };
	const mentionPatterns = parseMentionPatterns(body.mentionPatterns);
	if (!mentionPatterns) return { ok: false, message: "mentionPatterns must be a non-empty string or string array" };
	const accountRef = readRequiredString(body, "accountRef", 200);
	if (!accountRef) return { ok: false, message: "accountRef is required" };
	const defaultModel = readRequiredString(body, "defaultModel", 200);
	if (!defaultModel) return { ok: false, message: "defaultModel is required" };
	const roleId = readRequiredString(body, "roleId", 100) ?? "worker";

	const roleDescription = readOptionalString(body, "roleDescription", 4096);
	if (roleDescription === null) return { ok: false, message: "roleDescription must be a string (<=4096 chars)" };
	const avatar = readOptionalString(body, "avatar", 2048);
	if (avatar === null) return { ok: false, message: "avatar must be a string (<=2048 chars)" };
	const color = parseColor(body.color);
	if (color === null) return { ok: false, message: "color must be {primary, secondary} strings" };

	const enabledRaw = body.enabled;
	if (enabledRaw !== undefined && typeof enabledRaw !== "boolean") {
		return { ok: false, message: "enabled must be a boolean" };
	}
	const contextWindowRaw = body.contextWindow;
	if (
		contextWindowRaw !== undefined &&
		(!Number.isInteger(contextWindowRaw) ||
			(contextWindowRaw as number) <= 0 ||
			(contextWindowRaw as number) > 10_000_000)
	) {
		return { ok: false, message: "contextWindow must be a positive integer" };
	}

	return {
		ok: true,
		input: {
			id,
			displayName,
			mentionPatterns,
			accountRef,
			defaultModel,
			roleId,
			...(roleDescription !== undefined ? { roleDescription } : {}),
			...(enabledRaw !== undefined ? { enabled: enabledRaw as boolean } : {}),
			...(contextWindowRaw !== undefined ? { contextWindow: contextWindowRaw as number } : {}),
			...(avatar !== undefined ? { avatar } : {}),
			...(color !== undefined ? { color } : {}),
		},
	};
}

function catalogErrorToHttp(error: CatalogError): { status: number; code: string; message: string } {
	switch (error.code) {
		case "agent_id_duplicate":
			return { status: 409, code: "agent_exists", message: error.message };
		case "mention_pattern_conflict":
			return { status: 409, code: "mention_pattern_conflict", message: error.message };
		case "account_ref_unresolved":
			return { status: 422, code: "account_not_found", message: error.message };
		case "default_model_not_in_account":
			return { status: 422, code: "model_not_in_account", message: error.message };
		case "catalog_invalid_json":
			return { status: 500, code: "catalog_corrupt", message: error.message };
		default:
			return { status: 400, code: "invalid_input", message: error.message };
	}
}

export function createAgentRoutes(options: AgentRoutesOptions): AgentRoutes {
	const { registry, tracker } = options;
	const clock = options.clock ?? Date.now;

	function accountStore(): AccountStore | null {
		if (!options.accountsPath) return null;
		return new AccountStore({
			accountsPath: options.accountsPath,
			credentialsPath: options.credentialsPath ?? join(dirname(options.accountsPath), "credentials.json"),
		});
	}

	function accountView(store: AccountStore, account: AccountConfig, boundAgentIds: string[]): AccountView {
		const provider = findAccountProvider(account.provider);
		return {
			ref: account.ref,
			...(account.displayName ? { displayName: account.displayName } : {}),
			provider: account.provider,
			providerLabel: provider?.label ?? account.provider,
			...(account.apiUrl ? { apiUrl: account.apiUrl } : {}),
			models: [...account.models],
			credential: store.credentialKind(account),
			boundAgentIds,
		};
	}

	function accountViews(store: AccountStore): AccountView[] {
		const agents = [...registry.agents.values()];
		return store.list().map((account) =>
			accountView(
				store,
				account,
				agents
					.filter((agent) => agent.accountRef === account.ref)
					.map((agent) => agent.id)
					.sort(),
			),
		);
	}

	function reloadFromFiles(): void {
		const catalogPaths = paths();
		if (!catalogPaths) return;
		const { catalog, accounts } = readCatalogFile(catalogPaths);
		reloadRegistry(registry, catalog, accounts);
	}

	function accountErrorToHttp(error: AccountError): { status: number; code: string; message: string } {
		switch (error.code) {
			case "account_exists":
				return { status: 409, code: error.code, message: error.message };
			case "account_not_found":
				return { status: 404, code: error.code, message: error.message };
			case "accounts_invalid_json":
				return { status: 500, code: error.code, message: error.message };
			default:
				return { status: 422, code: error.code, message: error.message };
		}
	}

	function csrfOk(request: IncomingMessage, response: ServerResponse, context: ApiRouteContext): boolean {
		const csrf = request.headers["x-csrf-token"];
		const csrfToken = Array.isArray(csrf) ? csrf[0] : csrf;
		if (!requireCsrf(context.session, csrfToken)) {
			sendError(response, 403, "csrf_failed", "invalid CSRF token");
			return false;
		}
		return true;
	}

	async function readBody(
		request: IncomingMessage,
		response: ServerResponse,
	): Promise<Record<string, unknown> | null> {
		let body: unknown;
		try {
			body = await readJsonBody(request);
		} catch (error) {
			if (error instanceof HttpError) {
				sendError(response, error.status, error.code, error.message);
				return null;
			}
			throw error;
		}
		if (!isRecord(body)) {
			sendError(response, 400, "invalid_input", "request body must be a JSON object");
			return null;
		}
		return body;
	}

	function readModels(value: unknown): string[] | null {
		if (!Array.isArray(value)) return null;
		return value.filter((item): item is string => typeof item === "string");
	}

	async function handleAccounts(
		request: IncomingMessage,
		response: ServerResponse,
		url: URL,
		context: ApiRouteContext,
	): Promise<boolean> {
		const store = accountStore();
		if (!store) return false;
		if (url.pathname === "/api/providers") {
			if (request.method !== "GET") return false;
			sendJson(response, 200, { providers: ACCOUNT_PROVIDERS });
			return true;
		}
		if (url.pathname === "/api/accounts") {
			if (request.method === "GET") {
				sendJson(response, 200, { accounts: accountViews(store) });
				return true;
			}
			if (request.method === "POST") {
				if (!csrfOk(request, response, context)) return true;
				const body = await readBody(request, response);
				if (!body) return true;
				const models = readModels(body.models);
				if (models === null) {
					sendError(response, 400, "invalid_input", "models must be an array of strings");
					return true;
				}
				try {
					const account = store.create({
						ref: typeof body.ref === "string" ? body.ref : "",
						...(typeof body.displayName === "string" ? { displayName: body.displayName } : {}),
						provider: typeof body.provider === "string" ? body.provider : "",
						...(typeof body.apiUrl === "string" ? { apiUrl: body.apiUrl } : {}),
						models,
						...(typeof body.apiKey === "string" ? { apiKey: body.apiKey } : {}),
						...(typeof body.envName === "string" ? { envName: body.envName } : {}),
					});
					reloadFromFiles();
					sendJson(response, 201, { account: accountView(store, account, []) });
				} catch (error) {
					if (error instanceof AccountError) {
						const mapped = accountErrorToHttp(error);
						sendError(response, mapped.status, mapped.code, mapped.message);
						return true;
					}
					throw error;
				}
				return true;
			}
			return false;
		}
		const match = /^\/api\/accounts\/([^/]+)$/.exec(url.pathname);
		if (!match) return false;
		const ref = decodeURIComponent(match[1]!);
		if (request.method === "PATCH") {
			if (!csrfOk(request, response, context)) return true;
			const body = await readBody(request, response);
			if (!body) return true;
			const models = body.models === undefined ? undefined : readModels(body.models);
			if (models === null) {
				sendError(response, 400, "invalid_input", "models must be an array of strings");
				return true;
			}
			try {
				const account = store.update(ref, {
					...(typeof body.displayName === "string" ? { displayName: body.displayName } : {}),
					...(body.displayName === null ? { displayName: null } : {}),
					...(typeof body.provider === "string" ? { provider: body.provider } : {}),
					...(typeof body.apiUrl === "string" ? { apiUrl: body.apiUrl } : {}),
					...(body.apiUrl === null ? { apiUrl: null } : {}),
					...(models !== undefined ? { models } : {}),
					...(typeof body.apiKey === "string" ? { apiKey: body.apiKey } : {}),
					...(typeof body.envName === "string" ? { envName: body.envName } : {}),
				});
				reloadFromFiles();
				sendJson(response, 200, { account: accountView(store, account, []) });
			} catch (error) {
				if (error instanceof AccountError) {
					const mapped = accountErrorToHttp(error);
					sendError(response, mapped.status, mapped.code, mapped.message);
					return true;
				}
				throw error;
			}
			return true;
		}
		if (request.method === "DELETE") {
			if (!csrfOk(request, response, context)) return true;
			const boundAgentIds = [...registry.agents.values()]
				.filter((agent) => agent.accountRef === ref)
				.map((agent) => agent.id)
				.sort();
			if (boundAgentIds.length > 0) {
				sendJson(response, 409, {
					error: "account_in_use",
					message: "account is bound to agents",
					agentIds: boundAgentIds,
				});
				return true;
			}
			try {
				store.remove(ref);
				reloadFromFiles();
				sendJson(response, 200, { ok: true });
			} catch (error) {
				if (error instanceof AccountError) {
					const mapped = accountErrorToHttp(error);
					sendError(response, mapped.status, mapped.code, mapped.message);
					return true;
				}
				throw error;
			}
			return true;
		}
		return false;
	}

	function activeAgentIds(): Set<string> {
		return new Set(tracker.listStaleSlots(clock(), 0).map((slot) => slot.agentId));
	}

	function views(): AgentView[] {
		const activeAgents = activeAgentIds();
		return [...registry.agents.values()].map((agent) => toView(agent, activeAgents));
	}

	function paths(): CatalogPaths | null {
		if (!options.catalogPath || !options.accountsPath) return null;
		return { catalogPath: options.catalogPath, accountsPath: options.accountsPath };
	}

	async function createAgent(
		request: IncomingMessage,
		response: ServerResponse,
		context: ApiRouteContext,
	): Promise<true> {
		const csrf = request.headers["x-csrf-token"];
		const csrfToken = Array.isArray(csrf) ? csrf[0] : csrf;
		if (!requireCsrf(context.session, csrfToken)) {
			sendError(response, 403, "csrf_failed", "invalid CSRF token");
			return true;
		}

		const catalogPaths = paths();
		if (!catalogPaths) {
			sendError(response, 503, "agent_management_unavailable", "agent catalog paths are not configured");
			return true;
		}

		let body: unknown;
		try {
			body = await readJsonBody(request);
		} catch (error) {
			if (error instanceof HttpError) {
				sendError(response, error.status, error.code, error.message);
				return true;
			}
			throw error;
		}
		if (!isRecord(body)) {
			sendError(response, 400, "invalid_input", "request body must be a JSON object");
			return true;
		}
		const parsed = parseCreateInput(body);
		if (!parsed.ok) {
			sendError(response, 400, "invalid_input", parsed.message);
			return true;
		}

		try {
			const { catalog, accounts } = readCatalogFile(catalogPaths);
			const agent = toAgentConfig(parsed.input);
			const candidate = appendAgent(catalog, agent);
			validateCandidate(candidate, accounts);
			writeCatalogAtomic(catalogPaths.catalogPath, candidate);
			reloadRegistry(registry, candidate, accounts);
			sendJson(response, 201, { agent: toView(agent, new Set()) });
		} catch (error) {
			if (error instanceof CatalogError) {
				const mapped = catalogErrorToHttp(error);
				sendError(response, mapped.status, mapped.code, mapped.message);
				return true;
			}
			const message = error instanceof Error ? error.message : String(error);
			sendError(response, 500, "catalog_write_failed", message);
		}
		return true;
	}

	async function handle(
		request: IncomingMessage,
		response: ServerResponse,
		url: URL,
		context: ApiRouteContext,
	): Promise<boolean> {
		if (await handleAccounts(request, response, url, context)) return true;
		if (url.pathname === "/api/agents") {
			if (request.method === "GET") {
				sendJson(response, 200, { agents: views() });
				return true;
			}
			if (request.method === "POST") return createAgent(request, response, context);
			return false;
		}
		if (request.method !== "GET") return false;
		if (url.pathname === "/api/cats") {
			const cats: HubCatView[] = views().map((agent) => ({ ...agent, catId: agent.id }));
			sendJson(response, 200, { cats });
			return true;
		}
		if (url.pathname === "/api/config") {
			sendJson(response, 200, { config: { ui: { bubbleDefaults: {} } } });
			return true;
		}
		return false;
	}

	return { handle };
}
