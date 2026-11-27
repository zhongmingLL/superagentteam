import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession } from "@superagentteam/shared/types";
import { afterEach, describe, expect, it } from "vitest";
import { AccountStore } from "../src/domains/accounts/store.ts";
import { freshPiSessionId, PiWorkerSpawnPort, resolveRichMessagingSkillPath } from "../src/domains/workers/pi-spawn.ts";

// F018 R3-d: real child-process spawn contract. This is not a mock spawn port:
// PiWorkerSpawnPort launches a Node process over stdio and speaks the pi RPC
// framing, so the argv/env/cwd surface is exercised exactly as production.

const dirs: string[] = [];

const STUB = `const fs = require("node:fs");
fs.writeFileSync(process.env.SPAWN_CONTRACT_FILE, JSON.stringify({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  agentDir: process.env.PI_CODING_AGENT_DIR,
  workerId: process.env.SUPERAGENTTEAM_WORKER_ID,
  controlSocket: process.env.SUPERAGENTTEAM_CONTROL_SOCKET,
  controlToken: process.env.SUPERAGENTTEAM_CONTROL_TOKEN,
}));
let buffer = "";
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
const handle = (request) => {
  if (request.type === "get_state") {
    send({ id: request.id, type: "response", command: "get_state", success: true, data: { sessionId: "stub-session", sessionFile: "/tmp/stub-session.json" } });
    return;
  }
  if (request.type === "prompt") {
    send({ id: request.id, type: "response", command: "prompt", success: true, data: {} });
    send({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "stub reply" } });
    send({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "stub reply" }], usage: { inputTokens: 1, outputTokens: 1 } } });
    send({ type: "agent_settled", aborted: false });
    return;
  }
  send({ id: request.id, type: "response", command: request.type, success: true, data: {} });
};
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (let index = buffer.indexOf("\\n"); index >= 0; index = buffer.indexOf("\\n")) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) handle(JSON.parse(line));
  }
});
process.stdin.on("end", () => process.exit(0));
`;

function makeSession(workingDirectory: string): AgentSession {
	return {
		id: "session-1",
		threadId: "t1",
		agentId: "a1",
		userId: "u1",
		seq: 0,
		lastCountedTurnExecutionId: null,
		status: "active",
		piSessionId: null,
		piSessionFile: null,
		workingDirectory,
		messageCount: 0,
		consecutiveResumeFailures: 0,
		sealReason: null,
		createdAt: 1,
		updatedAt: 1,
		sealedAt: null,
	};
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("F018 R3-d real worker spawn surface", () => {
	it("spawns a real process with the pi RPC argv/env/cwd contract and completes a prompt", async () => {
		const dir = mkdtempSync(join(tmpdir(), "f018-r3d-spawn-"));
		dirs.push(dir);
		const projectPath = join(dir, "project");
		const sessionDir = join(dir, "sessions");
		const workerAgentDir = join(dir, "agent");
		const contractFile = join(dir, "contract.json");
		const stubPath = join(dir, "stub-cli.cjs");
		mkdirSync(projectPath, { recursive: true });
		writeFileSync(stubPath, STUB);

		const port = new PiWorkerSpawnPort({
			cliPath: stubPath,
			sessionDir,
			workerAgentDir,
			controlSocketPath: "/tmp/superagentteam-a2a.sock",
			richMessagingSkillPath: "/tmp/superagentteam-rich-messaging",
			env: { ...process.env, SPAWN_CONTRACT_FILE: contractFile },
			offline: true,
		});
		const spawned = await port.spawn({
			workerId: "worker-1",
			poolKey: { projectPath, accountRef: "main", provider: "openrouter", model: "model-1" },
			session: makeSession(projectPath),
			now: 1_000,
			credentialToken: "ct1.test.secret",
		});
		try {
			const contract = JSON.parse(readFileSync(contractFile, "utf8")) as {
				argv: string[];
				cwd: string;
				agentDir: string;
				workerId: string;
				controlSocket: string;
				controlToken: string;
			};
			expect(contract.cwd).toBe(projectPath);
			expect(contract.agentDir).toBe(join(workerAgentDir, "worker-1"));
			expect(contract.workerId).toBe("worker-1");
			expect(contract.controlSocket).toBe("/tmp/superagentteam-a2a.sock");
			expect(contract.controlToken).toBe("ct1.test.secret");
			expect(contract.argv).toEqual(
				expect.arrayContaining([
					"--mode",
					"rpc",
					"--extension",
					"--no-extensions",
					"--no-context-files",
					"--no-mcp",
					"--skill",
					"/tmp/superagentteam-rich-messaging",
					"--approve",
					"--provider",
					"openrouter",
					"--model",
					"model-1",
					"--session-dir",
					sessionDir,
					"--session-id",
				]),
			);
			expect(contract.argv.join(" ")).not.toContain("--tools");
			expect(contract.argv.find((arg) => arg.startsWith("sat-session-1-"))).toBeTruthy();
			expect(spawned.pid).toBeTypeOf("number");
			expect(spawned.piSessionId).toBe("stub-session");

			const events: string[] = [];
			spawned.connection.onEvent((event) => events.push(event.type));
			const prompted = await spawned.connection.promptAndWait("hello", { timeoutMs: 10_000 });
			expect(prompted.aborted).toBe(false);
			expect(events).toEqual(expect.arrayContaining(["message_update", "message_end", "agent_settled"]));
		} finally {
			await spawned.connection.finish();
		}
	});

	it("resolves the shipped rich-messaging skill path", () => {
		const path = resolveRichMessagingSkillPath();
		expect(path).toContain("superagentteam-rich-messaging");
	});

	it("isolates account credentials and base URL into the worker agent dir", async () => {
		const dir = mkdtempSync(join(tmpdir(), "f018-r3d-account-"));
		dirs.push(dir);
		const projectPath = join(dir, "project");
		const workerAgentDir = join(dir, "agent");
		const accountsPath = join(dir, "accounts.json");
		const credentialsPath = join(dir, "credentials.json");
		writeFileSync(
			accountsPath,
			JSON.stringify([
				{
					ref: "main",
					provider: "openrouter",
					apiKeyRef: "secret:main",
					apiUrl: "https://gateway.example/v1",
					models: ["model-1"],
				},
			]),
		);
		writeFileSync(credentialsPath, JSON.stringify({ main: { apiKey: "sk-account-key" } }), { mode: 0o600 });
		mkdirSync(projectPath, { recursive: true });
		const port = new PiWorkerSpawnPort({
			cliPath: join(dir, "stub-cli.cjs"),
			sessionDir: join(dir, "sessions"),
			workerAgentDir,
			env: { ...process.env, SPAWN_CONTRACT_FILE: join(dir, "contract.json") },
			offline: true,
			accountStore: new AccountStore({ accountsPath, credentialsPath }),
		});
		writeFileSync(join(dir, "stub-cli.cjs"), STUB);
		const spawned = await port.spawn({
			workerId: "worker-cred",
			poolKey: { projectPath, accountRef: "main", provider: "openrouter", model: "model-1" },
			session: makeSession(projectPath),
			now: 1_000,
			credentialToken: "ct1.test.secret",
		});
		try {
			const agentDir = join(workerAgentDir, "worker-cred");
			const contract = JSON.parse(readFileSync(join(dir, "contract.json"), "utf8")) as { agentDir: string };
			expect(contract.agentDir).toBe(agentDir);
			expect(JSON.parse(readFileSync(join(agentDir, "auth.json"), "utf8"))).toEqual({
				openrouter: { type: "api_key", key: "sk-account-key" },
			});
			expect(JSON.parse(readFileSync(join(agentDir, "models.json"), "utf8"))).toEqual({
				providers: { openrouter: { baseUrl: "https://gateway.example/v1" } },
			});
		} finally {
			await spawned.connection.finish();
		}
	});
});

describe("freshPiSessionId", () => {
	it("sanitizes colon-delimited agent session ids into a CLI-valid pi session id", () => {
		const id = freshPiSessionId({ ...makeSession("/tmp"), id: "sess:t1:a1:0" }, 1_000);
		expect(id).toMatch(/^sat-sess-t1-a1-0-[a-z0-9]+$/);
		expect(id).not.toContain(":");
		expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$/);
	});
});
