import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface RuntimeEnvAccount {
	readonly ref: string;
	readonly apiKeyRef?: string;
	readonly credential?: { readonly kind?: string; readonly envName?: string };
}

export interface ResolvedRuntimeEnv {
	readonly env: Record<string, string>;
	readonly requiredEnvNames: string[];
	readonly missingEnvNames: string[];
}

export function defaultRuntimeEnvFile(env: NodeJS.ProcessEnv = process.env): string {
	const home = env.HOME?.trim() || env.USERPROFILE?.trim() || homedir();
	return join(home, ".config", "superagentteam", "runtime.env");
}

export function parseRuntimeEnvFile(text: string): Record<string, string> {
	const values: Record<string, string> = {};
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === "" || line.startsWith("#")) continue;
		const withoutExport = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
		const equals = withoutExport.indexOf("=");
		if (equals <= 0) continue;
		const key = withoutExport.slice(0, equals).trim();
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
		let value = withoutExport.slice(equals + 1).trim();
		if (
			value.length >= 2 &&
			((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
		) {
			value = value.slice(1, -1);
		}
		values[key] = value;
	}
	return values;
}

export function readAccountsFile(dataDir: string): RuntimeEnvAccount[] {
	const file = join(dataDir, "accounts.json");
	if (!existsSync(file)) return [];
	const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
	if (!Array.isArray(parsed)) return [];
	return parsed.filter(
		(entry): entry is RuntimeEnvAccount => typeof entry === "object" && entry !== null && "ref" in entry,
	);
}

export function requiredEnvNames(accounts: readonly RuntimeEnvAccount[]): string[] {
	const names = new Set<string>();
	for (const account of accounts) {
		if (account.apiKeyRef) names.add(account.apiKeyRef);
		if (account.credential?.kind === "env" && account.credential.envName) names.add(account.credential.envName);
	}
	return [...names].sort();
}

export function resolveRuntimeEnv(input: {
	readonly dataDir: string;
	readonly envFile?: string | null;
	readonly inherited: Readonly<Record<string, string | undefined>>;
	readonly requiredNames?: readonly string[];
}): ResolvedRuntimeEnv {
	const fileValues =
		input.envFile && existsSync(input.envFile) ? parseRuntimeEnvFile(readFileSync(input.envFile, "utf8")) : {};
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(fileValues)) env[key] = value;
	for (const [key, value] of Object.entries(input.inherited)) {
		if (value !== undefined && value !== "") env[key] = value;
	}
	const names = input.requiredNames ?? requiredEnvNames(readAccountsFile(input.dataDir));
	const missingEnvNames = names.filter((name) => !env[name]);
	return { env, requiredEnvNames: [...names], missingEnvNames };
}
