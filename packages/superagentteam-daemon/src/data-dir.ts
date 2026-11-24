import { chmodSync, mkdirSync } from "node:fs";
import { ControlError } from "./control/errors.ts";
import { resolveDataDir } from "./env.ts";

/** Resolve and prepare the 0700 data directory shared by v1 surfaces. */
export function resolveControlDataDir(dataDir?: string): string {
	const resolved = resolveDataDir(dataDir);
	if (!resolved || resolved.trim() === "") {
		throw new ControlError("data_dir_missing", "SUPERAGENTTEAM_DATA_DIR is required");
	}
	try {
		mkdirSync(resolved, { recursive: true, mode: 0o700 });
		chmodSync(resolved, 0o700);
	} catch (error) {
		throw new ControlError("database_open_failed", `cannot prepare control data dir: ${String(error)}`, {
			cause: error,
		});
	}
	return resolved;
}
