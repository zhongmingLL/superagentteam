import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ControlError } from "../control/errors.ts";
import type { RuntimeStateFile } from "./types.ts";

export const RUNTIME_STATE_FILE = "runtime-state.json";

export function resolveRuntimeStatePath(dataDir: string): string {
	return join(dataDir, RUNTIME_STATE_FILE);
}

export function writeRuntimeState(dataDir: string, state: RuntimeStateFile): string {
	mkdirSync(dataDir, { recursive: true, mode: 0o700 });
	const stateFile = resolveRuntimeStatePath(dataDir);
	const tmp = `${stateFile}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
	chmodSync(tmp, 0o600);
	renameSync(tmp, stateFile);
	return stateFile;
}

export function readRuntimeState(dataDir: string): RuntimeStateFile | null {
	const stateFile = resolveRuntimeStatePath(dataDir);
	if (!existsSync(stateFile)) return null;
	try {
		return JSON.parse(readFileSync(stateFile, "utf8")) as RuntimeStateFile;
	} catch (error) {
		throw new ControlError("runtime_state_invalid", `runtime state is not valid JSON: ${stateFile}`, {
			cause: error,
		});
	}
}
