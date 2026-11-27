import type { LogLevel } from "../../observability/contracts.ts";

// Structured A2A lifecycle log hook. The daemon wires this to the local
// JsonlLogStore; tests can inject a collector. Events carry identifiers only
// (thread/invocation/queue entry/attempt), never prompt or response content.
export type A2ALog = (level: LogLevel, event: string, fields?: Record<string, unknown>) => void;
