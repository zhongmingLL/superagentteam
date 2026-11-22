import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { dirname } from "node:path";

import type { AccountConfig, AgentCatalog, AgentConfig } from "@superagentteam/shared/types";

import { CatalogError, type CatalogPaths, validateCatalog } from "./registry.ts";

// F025 S1: installation-level agent catalog writes. The catalog is the only
// persisted truth for agents; secrets stay in accounts.json/env and are never
// read or written here. Writes are serialized by the synchronous critical
// section and committed with temp + fsync + atomic rename (0008 §2).

export interface CreateAgentInput {
	id: string;
	displayName: string;
	mentionPatterns: readonly string[];
	accountRef: string;
	defaultModel: string;
	roleId: string;
	roleDescription?: string;
	enabled?: boolean;
	contextWindow?: number;
	avatar?: string;
	color?: { primary: string; secondary: string };
}

export interface CatalogFile {
	catalog: AgentCatalog;
	accounts: AccountConfig[];
}

export function readCatalogFile(paths: CatalogPaths): CatalogFile {
	let catalog: AgentCatalog;
	try {
		catalog = JSON.parse(readFileSync(paths.catalogPath, "utf8")) as AgentCatalog;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			catalog = { version: 1, agents: [] };
		} else {
			throw new CatalogError("catalog_invalid_json", `catalog: ${(error as Error).message}`);
		}
	}
	let accounts: AccountConfig[];
	try {
		accounts = JSON.parse(readFileSync(paths.accountsPath, "utf8")) as AccountConfig[];
	} catch (error) {
		throw new CatalogError("catalog_invalid_json", `accounts: ${(error as Error).message}`);
	}
	return { catalog, accounts };
}

export function toAgentConfig(input: CreateAgentInput): AgentConfig {
	return {
		id: input.id.trim(),
		mentionPatterns: [...input.mentionPatterns],
		displayName: input.displayName.trim(),
		contextWindow: input.contextWindow ?? 128_000,
		roleId: input.roleId.trim(),
		roleDescription: input.roleDescription?.trim() ?? "",
		restrictions: [],
		strengths: [],
		accountRef: input.accountRef.trim(),
		defaultModel: input.defaultModel.trim(),
		sessionChain: true,
		enabled: input.enabled ?? true,
		...(input.avatar ? { avatar: input.avatar } : {}),
		...(input.color ? { color: { ...input.color } } : {}),
	};
}

/** Validate a candidate catalog before any file mutation. */
export function validateCandidate(catalog: AgentCatalog, accounts: readonly AccountConfig[]): void {
	validateCatalog(catalog, accounts);
}

export function appendAgent(catalog: AgentCatalog, agent: AgentConfig): AgentCatalog {
	return { version: 1, agents: [...catalog.agents, agent] };
}

export function writeCatalogAtomic(path: string, catalog: AgentCatalog): void {
	const dir = dirname(path);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
	let fd: number | null = null;
	try {
		fd = openSync(temp, "w", 0o600);
		writeSync(fd, `${JSON.stringify(catalog, null, 2)}\n`);
		fsyncSync(fd);
	} finally {
		if (fd !== null) closeSync(fd);
	}
	renameSync(temp, path);
}
