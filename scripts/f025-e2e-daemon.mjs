#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { createConsoleToken } from "../packages/superagentteam-daemon/dist/api/console-link.js";
import { initOperatorCredential, startDaemon } from "../packages/superagentteam-daemon/dist/index.js";

// F025 full-stack A2A E2E launcher. Isolated data dir + A2A control plane +
// browser API; the web dev server proxies /api and /auth/console to this port.
// Secrets are never read here: accounts.json holds only apiKeyRef, and the
// provider key must already be in the daemon environment (e.g. KIMI_API_KEY).

const repoRoot = resolve(import.meta.dirname, "..");
const dataDir = resolve(process.env.SUPERAGENTTEAM_E2E_DATA_DIR ?? join(repoRoot, ".e2e-data"));
const port = Number(process.env.SUPERAGENTTEAM_E2E_PORT ?? "3011");
const hubOrigin = process.env.SUPERAGENTTEAM_HUB_ORIGIN ?? "http://localhost:3000";

mkdirSync(dataDir, { recursive: true, mode: 0o700 });
if (!existsSync(join(dataDir, "agent-catalog.json"))) {
	writeFileSync(join(dataDir, "agent-catalog.json"), `${JSON.stringify({ version: 1, agents: [] }, null, 2)}\n`, {
		mode: 0o600,
	});
}
if (!existsSync(join(dataDir, "accounts.json"))) {
	process.stderr.write(`missing ${join(dataDir, "accounts.json")}\n`);
	process.exit(2);
}

initOperatorCredential({ dataDir });
const daemon = await startDaemon({
	installationRoot: repoRoot,
	dataDir,
	runningRevision: "f025-e2e",
	controlPlane: false,
	a2aControlPlane: { pollIntervalMs: 500, sweepIntervalMs: 30_000 },
	hubOrigin,
	port,
	staticDir: false,
});
daemon.markReady();

const base = new URL(daemon.healthUrl).origin;
const consoleHost = new URL(hubOrigin).hostname;
const token = createConsoleToken({ dataDir, ttlMs: 60 * 60 * 1000 });
process.stdout.write(
	`${JSON.stringify({ base, healthUrl: daemon.healthUrl, consoleUrl: `http://${consoleHost}:${port}/auth/console?token=${encodeURIComponent(token.token)}` })}\n`,
);

let stopping = false;
const stop = async () => {
	if (stopping) return;
	stopping = true;
	await daemon.stop().catch(() => {});
	process.exit(0);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
await new Promise(() => {});
