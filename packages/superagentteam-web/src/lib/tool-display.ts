import type { StoredToolEvent } from "@superagentteam/shared/types";

const SENSITIVE_KEY = /token|secret|password|passwd|api[_-]?key|authorization|cookie|credential/i;
const MAX_STRING = 1_200;
const MAX_ITEMS = 24;
const MAX_DETAIL_CHARS = 4_000;

function sanitize(value: unknown, depth = 0): unknown {
	if (depth > 5) return "[truncated]";
	if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
	if (typeof value !== "object" || value === null) return value;
	if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((item) => sanitize(item, depth + 1));
	const result: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value).slice(0, MAX_ITEMS)) {
		result[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : sanitize(entry, depth + 1);
	}
	return result;
}

export function formatToolJson(value: unknown): string {
	if (value === undefined) return "";
	try {
		return JSON.stringify(sanitize(value), null, 2);
	} catch {
		return String(value);
	}
}

export function toolDetail(record: StoredToolEvent): string {
	const parts: string[] = [];
	if (record.args !== undefined) parts.push(`args:\n${formatToolJson(record.args)}`);
	if (record.result !== undefined) parts.push(`result:\n${formatToolJson(record.result)}`);
	const detail = parts.join("\n\n");
	return detail.length > MAX_DETAIL_CHARS ? `${detail.slice(0, MAX_DETAIL_CHARS)}…` : detail;
}

export function toolFailed(record: StoredToolEvent): boolean {
	if (record.status !== "completed" || record.result === undefined || record.result === null) return false;
	if (typeof record.result !== "object" || Array.isArray(record.result)) return false;
	const result = record.result as Record<string, unknown>;
	if (result.isError === true || result.error !== undefined) return true;
	const details = result.details;
	return typeof details === "object" && details !== null && (details as Record<string, unknown>).isError === true;
}

export function formatToolDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "0s";
	const seconds = Math.round(ms / 1_000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const rest = seconds % 60;
	return rest === 0 ? `${minutes}m` : `${minutes}m${rest}s`;
}

export function toolDuration(record: StoredToolEvent, now = Date.now()): number {
	return Math.max(0, (record.endedAt ?? now) - record.at);
}

export function totalToolDuration(records: readonly StoredToolEvent[], now = Date.now()): number {
	if (records.length === 0) return 0;
	const start = Math.min(...records.map((record) => record.at));
	const end = Math.max(...records.map((record) => record.endedAt ?? now));
	return Math.max(0, end - start);
}
