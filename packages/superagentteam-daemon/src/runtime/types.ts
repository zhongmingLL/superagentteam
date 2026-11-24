import type { ProcessIdentityProvider } from "../lifecycle/process.ts";
import type { ProcessSignalSender } from "../lifecycle/signal.ts";
import type { ProcessIdentity } from "../lifecycle/types.ts";

export type RuntimeLifecycleState = "starting" | "running" | "degraded" | "stopped" | "failed";

export interface RuntimeProcessRecord {
	readonly pid: number;
	readonly startedAt: string;
	readonly command: string;
}

export interface RuntimeStateFile {
	readonly schemaVersion: 1;
	readonly worktree: string;
	readonly head: string;
	readonly dataDir: string;
	readonly webPort: number;
	readonly daemonPort: number;
	readonly hubOrigin: string;
	readonly windowsPort: number | null;
	readonly envFile: string | null;
	readonly state: RuntimeLifecycleState;
	readonly daemon: RuntimeProcessRecord | null;
	readonly web: RuntimeProcessRecord | null;
	readonly daemonBootId: string | null;
	readonly startedAt: string;
	readonly updatedAt: string;
	readonly lastError?: { readonly code: string; readonly message: string };
}

export interface RuntimeStartOptions {
	readonly worktree: string;
	readonly head: string;
	readonly dataDir: string;
	readonly webPort: number;
	readonly daemonPort: number;
	readonly hubOrigin: string;
	readonly windowsPort: number | null;
	readonly envFile: string | null;
	readonly env: Readonly<Record<string, string>>;
	readonly requiredEnvNames: readonly string[];
}

export interface RuntimeDaemonSpawnInput {
	readonly worktree: string;
	readonly dataDir: string;
	readonly port: number;
	readonly hubOrigin: string;
	readonly revision: string;
	readonly env: Readonly<Record<string, string>>;
}

export interface RuntimeWebSpawnInput {
	readonly worktree: string;
	readonly webPort: number;
	readonly daemonPort: number;
	readonly env: Readonly<Record<string, string>>;
}

export interface RuntimeSpawner {
	spawnDaemon(input: RuntimeDaemonSpawnInput): { readonly pid: number };
	spawnWeb(input: RuntimeWebSpawnInput): { readonly pid: number };
}

export interface RuntimeHealthProbe {
	daemon(port: number): Promise<boolean>;
	web(port: number): Promise<boolean>;
}

export interface RuntimeServiceOptions {
	readonly dataDir: string;
	readonly spawner: RuntimeSpawner;
	readonly processProvider: ProcessIdentityProvider;
	readonly signalSender: ProcessSignalSender;
	readonly health: RuntimeHealthProbe;
	readonly isPortFree: (port: number) => Promise<boolean>;
	readonly readDaemonBootId?: (dataDir: string) => string | null;
	readonly clock?: () => Date;
	readonly sleep?: (ms: number) => Promise<void>;
	readonly startTimeoutMs?: number;
	readonly endGraceMs?: number;
}

export interface RuntimeStatusProcess {
	readonly pid: number;
	readonly alive: boolean;
	readonly identityVerified: boolean;
	readonly expected: RuntimeProcessRecord | null;
}

export interface RuntimeStatusReport {
	readonly state: "not_started" | "running" | "degraded" | "stale" | "stopped" | "failed";
	readonly dataDir: string;
	readonly stateFile: string;
	readonly worktree?: string;
	readonly head?: string;
	readonly webPort?: number;
	readonly daemonPort?: number;
	readonly hubOrigin?: string;
	readonly windowsPort?: number | null;
	readonly envFile?: string | null;
	readonly daemon?: RuntimeStatusProcess;
	readonly web?: RuntimeStatusProcess;
	readonly health?: { readonly daemon: boolean; readonly web: boolean };
	readonly windowsProxy: "configured" | "unverified" | "not_configured";
	readonly warnings?: readonly string[];
	readonly daemonBootId?: string | null;
	readonly lastError?: { readonly code: string; readonly message: string };
}

export interface RuntimeStartResult {
	readonly started: boolean;
	readonly status: RuntimeStatusReport;
}

export interface RuntimeEndResult {
	readonly changed: boolean;
	readonly state: RuntimeStatusReport["state"];
	readonly signaled: readonly number[];
	readonly mismatched: readonly number[];
}

export function toProcessRecord(identity: ProcessIdentity): RuntimeProcessRecord {
	return { pid: identity.pid, startedAt: identity.startedAt, command: identity.command };
}
