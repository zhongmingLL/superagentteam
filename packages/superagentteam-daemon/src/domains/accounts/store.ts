import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { dirname } from "node:path";

import type { AccountConfig } from "@superagentteam/shared/types";

import { findAccountProvider } from "./providers.ts";

export type AccountErrorCode =
	| "account_exists"
	| "account_not_found"
	| "credential_required"
	| "invalid_ref"
	| "invalid_provider"
	| "unsupported_provider_auth"
	| "invalid_models"
	| "invalid_api_url"
	| "invalid_env_name"
	| "accounts_invalid_json";

export class AccountError extends Error {
	readonly code: AccountErrorCode;

	constructor(code: AccountErrorCode, message?: string) {
		super(message ?? code);
		this.code = code;
		this.name = "AccountError";
	}
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

export interface AccountCreateInput {
	ref: string;
	displayName?: string;
	provider: string;
	apiUrl?: string;
	models: string[];
	apiKey?: string;
	envName?: string;
}

export interface AccountUpdateInput {
	displayName?: string | null;
	provider?: string;
	apiUrl?: string | null;
	models?: string[];
	apiKey?: string;
	envName?: string;
}

interface StoredCredential {
	apiKey: string;
}

type CredentialFile = Record<string, StoredCredential>;

const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ENV_PATTERN = /^[A-Z_][A-Za-z0-9_]*$/;

export interface AccountStoreOptions {
	accountsPath: string;
	credentialsPath: string;
}

function writeAtomic(path: string, data: unknown): void {
	const dir = dirname(path);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
	let fd: number | null = null;
	try {
		fd = openSync(temp, "w", 0o600);
		writeSync(fd, `${JSON.stringify(data, null, 2)}\n`);
		fsyncSync(fd);
	} finally {
		if (fd !== null) closeSync(fd);
	}
	renameSync(temp, path);
}

function readJson(path: string, fallback: unknown): unknown {
	if (!existsSync(path)) return fallback;
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		throw new AccountError("accounts_invalid_json", `invalid JSON in ${path}`);
	}
}

function normalizeModels(raw: unknown): string[] {
	if (!Array.isArray(raw)) throw new AccountError("invalid_models", "models must be an array");
	const models = raw
		.filter((value): value is string => typeof value === "string")
		.map((value) => value.trim())
		.filter((value) => value !== "");
	const unique = [...new Set(models)];
	if (unique.length === 0) throw new AccountError("invalid_models", "at least one model is required");
	if (unique.some((model) => model.length > 200)) throw new AccountError("invalid_models", "model id is too long");
	return unique;
}

function normalizeApiUrl(value: unknown): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value !== "string") throw new AccountError("invalid_api_url", "apiUrl must be a string");
	const trimmed = value.trim();
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new AccountError("invalid_api_url", "apiUrl must be a valid URL");
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new AccountError("invalid_api_url", "apiUrl must use http or https");
	}
	return trimmed;
}

function normalizeRef(value: unknown): string {
	if (typeof value !== "string" || !REF_PATTERN.test(value.trim())) {
		throw new AccountError("invalid_ref", "ref must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}");
	}
	return value.trim();
}

function normalizeDisplayName(value: unknown): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value !== "string") throw new AccountError("invalid_ref", "displayName must be a string");
	const trimmed = value.trim();
	if (trimmed.length > 80) throw new AccountError("invalid_ref", "displayName is too long");
	return trimmed;
}

function normalizeProvider(value: unknown): string {
	const provider = typeof value === "string" ? findAccountProvider(value.trim()) : undefined;
	if (!provider) {
		throw new AccountError("invalid_provider", "unknown provider");
	}
	if (!provider.selectable) {
		throw new AccountError(
			"unsupported_provider_auth",
			`provider "${provider.id}" requires special authentication; not supported yet`,
		);
	}
	return provider.id;
}

function normalizeEnvName(value: unknown): string {
	if (typeof value !== "string" || !ENV_PATTERN.test(value.trim())) {
		throw new AccountError("invalid_env_name", "env name must look like PROVIDER_API_KEY");
	}
	return value.trim();
}

function normalizeApiKey(value: unknown): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new AccountError("credential_required", "api key is required");
	}
	return value.trim();
}

export class AccountStore {
	private readonly accountsPath: string;
	private readonly credentialsPath: string;

	constructor(options: AccountStoreOptions) {
		this.accountsPath = options.accountsPath;
		this.credentialsPath = options.credentialsPath;
	}

	private readAccounts(): AccountConfig[] {
		const raw = readJson(this.accountsPath, []);
		if (!Array.isArray(raw)) throw new AccountError("accounts_invalid_json", "accounts.json must be an array");
		return raw as AccountConfig[];
	}

	private readCredentials(): CredentialFile {
		const raw = readJson(this.credentialsPath, {});
		if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
			throw new AccountError("accounts_invalid_json", "credentials.json must be an object");
		}
		return raw as CredentialFile;
	}

	private writeAccounts(accounts: AccountConfig[]): void {
		writeAtomic(this.accountsPath, accounts);
	}

	private writeCredentials(credentials: CredentialFile): void {
		writeAtomic(this.credentialsPath, credentials);
	}

	list(): AccountConfig[] {
		return this.readAccounts().sort((a, b) => a.ref.localeCompare(b.ref));
	}

	get(ref: string): AccountConfig | undefined {
		return this.readAccounts().find((account) => account.ref === ref);
	}

	credentialKind(account: AccountConfig): AccountCredentialView {
		if (account.apiKeyRef.startsWith("secret:")) return { kind: "stored" };
		if (account.apiKeyRef.startsWith("ENV:")) {
			return { kind: "env", envName: account.apiKeyRef.slice(4) };
		}
		if (ENV_PATTERN.test(account.apiKeyRef)) {
			return { kind: "env", envName: account.apiKeyRef };
		}
		return { kind: "none" };
	}

	resolveApiKey(account: AccountConfig): string | undefined {
		if (account.apiKeyRef.startsWith("secret:")) {
			return this.readCredentials()[account.ref]?.apiKey;
		}
		if (account.apiKeyRef.startsWith("ENV:")) {
			return process.env[account.apiKeyRef.slice(4)];
		}
		if (ENV_PATTERN.test(account.apiKeyRef)) return process.env[account.apiKeyRef];
		return undefined;
	}

	create(input: AccountCreateInput): AccountConfig {
		const ref = normalizeRef(input.ref);
		const accounts = this.readAccounts();
		if (accounts.some((account) => account.ref === ref)) {
			throw new AccountError("account_exists", `account ${ref} already exists`);
		}
		const provider = normalizeProvider(input.provider);
		const models = normalizeModels(input.models);
		const apiUrl = normalizeApiUrl(input.apiUrl);
		const displayName = normalizeDisplayName(input.displayName);
		let apiKeyRef: string;
		if (input.apiKey !== undefined) {
			const apiKey = normalizeApiKey(input.apiKey);
			const credentials = this.readCredentials();
			credentials[ref] = { apiKey };
			this.writeCredentials(credentials);
			apiKeyRef = `secret:${ref}`;
		} else if (input.envName !== undefined) {
			apiKeyRef = `ENV:${normalizeEnvName(input.envName)}`;
		} else {
			throw new AccountError("credential_required", "apiKey or envName is required");
		}
		const account: AccountConfig = {
			ref,
			provider,
			apiKeyRef,
			models,
			...(displayName ? { displayName } : {}),
			...(apiUrl ? { apiUrl } : {}),
		};
		this.writeAccounts([...accounts, account].sort((a, b) => a.ref.localeCompare(b.ref)));
		return account;
	}

	update(ref: string, input: AccountUpdateInput): AccountConfig {
		const normalizedRef = normalizeRef(ref);
		const accounts = this.readAccounts();
		const index = accounts.findIndex((account) => account.ref === normalizedRef);
		if (index < 0) throw new AccountError("account_not_found", `account ${normalizedRef} not found`);
		const current = accounts[index]!;
		const provider = input.provider === undefined ? current.provider : normalizeProvider(input.provider);
		const models = input.models === undefined ? [...current.models] : normalizeModels(input.models);
		const apiUrl = input.apiUrl === undefined ? current.apiUrl : (normalizeApiUrl(input.apiUrl) ?? undefined);
		const displayName =
			input.displayName === undefined
				? current.displayName
				: input.displayName === null
					? undefined
					: normalizeDisplayName(input.displayName);
		let apiKeyRef = current.apiKeyRef;
		if (input.apiKey !== undefined) {
			const apiKey = normalizeApiKey(input.apiKey);
			const credentials = this.readCredentials();
			credentials[normalizedRef] = { apiKey };
			this.writeCredentials(credentials);
			apiKeyRef = `secret:${normalizedRef}`;
		} else if (input.envName !== undefined) {
			const credentials = this.readCredentials();
			if (credentials[normalizedRef]) {
				delete credentials[normalizedRef];
				this.writeCredentials(credentials);
			}
			apiKeyRef = `ENV:${normalizeEnvName(input.envName)}`;
		}
		const next: AccountConfig = {
			ref: normalizedRef,
			provider,
			apiKeyRef,
			models,
			...(displayName ? { displayName } : {}),
			...(apiUrl ? { apiUrl } : {}),
		};
		accounts[index] = next;
		this.writeAccounts(accounts);
		return next;
	}

	remove(ref: string): void {
		const normalizedRef = normalizeRef(ref);
		const accounts = this.readAccounts();
		const next = accounts.filter((account) => account.ref !== normalizedRef);
		if (next.length === accounts.length) {
			throw new AccountError("account_not_found", `account ${normalizedRef} not found`);
		}
		const credentials = this.readCredentials();
		if (credentials[normalizedRef]) {
			delete credentials[normalizedRef];
			this.writeCredentials(credentials);
		}
		this.writeAccounts(next);
	}
}
