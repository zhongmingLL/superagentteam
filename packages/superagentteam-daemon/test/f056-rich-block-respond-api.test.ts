import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccountConfig, AgentCatalog, AgentConfig } from "@superagentteam/shared/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createConsoleToken } from "../src/api/console-link.ts";
import { initOperatorCredential } from "../src/domains/access/operator.ts";
import { type DaemonHandle, startDaemon } from "../src/index.ts";

const HUB_ORIGIN = "http://localhost:3000";
const ACCOUNT: AccountConfig = { ref: "main", provider: "pi", apiKeyRef: "KEY", models: ["m1"] };

function agentConfig(id: string): AgentConfig {
	return {
		id,
		mentionPatterns: [`@${id}`],
		displayName: `Agent ${id}`,
		contextWindow: 128_000,
		roleId: "worker",
		roleDescription: "F056 interactive response",
		restrictions: [],
		strengths: [],
		accountRef: "main",
		defaultModel: "m1",
		sessionChain: true,
		enabled: true,
	};
}

const INTERACTIVE_BLOCK = {
	id: "choose",
	kind: "interactive",
	v: 1,
	interactiveType: "select",
	title: "选一个方案",
	options: [
		{ id: "a", label: "方案 A" },
		{ id: "b", label: "方案 B", customInput: true },
	],
};

describe("F056 rich-block respond API", () => {
	let root: string;
	let dataDir: string;
	let installationRoot: string;
	let projectDir: string;
	let daemon: DaemonHandle | null;
	let base: string;
	let headers: Record<string, string>;

	beforeEach(async () => {
		root = mkdtempSync(join(tmpdir(), "f056-rich-respond-"));
		dataDir = join(root, "data");
		installationRoot = join(root, "install");
		projectDir = join(root, "project");
		mkdirSync(installationRoot);
		mkdirSync(projectDir);
		initOperatorCredential({ dataDir });
		const catalog: AgentCatalog = { version: 1, agents: [agentConfig("a1")] };
		writeFileSync(join(dataDir, "agent-catalog.json"), JSON.stringify(catalog));
		writeFileSync(join(dataDir, "accounts.json"), JSON.stringify([ACCOUNT]));
		daemon = await startDaemon({
			installationRoot,
			dataDir,
			runningRevision: "f056-rich-respond",
			hubOrigin: HUB_ORIGIN,
			a2aControlPlane: { pollIntervalMs: 3_600_000, sweepIntervalMs: 3_600_000 },
		});
		daemon.markReady();
		base = new URL(daemon.healthUrl).origin;
		const created = createConsoleToken({ dataDir, ttlMs: 60_000 });
		const exchange = await fetch(`${base}/auth/console?token=${encodeURIComponent(created.token)}`, {
			redirect: "manual",
		});
		const cookie = exchange.headers.get("set-cookie")!.split(";")[0]!;
		const session = (await fetch(`${base}/api/session`, { headers: { cookie } }).then((response) =>
			response.json(),
		)) as { csrfToken: string; userId: string };
		headers = {
			cookie,
			"x-csrf-token": session.csrfToken,
			origin: HUB_ORIGIN,
			"content-type": "application/json",
		};
	});

	afterEach(async () => {
		await daemon?.stop();
		daemon = null;
		rmSync(root, { recursive: true, force: true });
	});

	async function createThread(): Promise<string> {
		const response = await fetch(`${base}/api/threads`, {
			method: "POST",
			headers,
			body: JSON.stringify({ projectPath: projectDir, idempotencyKey: `thread-${Math.random()}` }),
		});
		expect(response.status).toBe(201);
		const body = (await response.json()) as { id: string };
		return body.id;
	}

	async function postRichMessage(
		threadId: string,
		block: Record<string, unknown> = INTERACTIVE_BLOCK,
	): Promise<string> {
		const response = await fetch(`${base}/api/messages`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				threadId,
				content: "要不要开始？@a1",
				idempotencyKey: `rich-${Math.random()}`,
				extra: { rich: { v: 1, blocks: [block] } },
			}),
		});
		expect(response.status).toBe(202);
		const receipt = (await response.json()) as { userMessageId: string };
		return receipt.userMessageId;
	}

	function respondUrl(messageId: string, blockId = "choose"): string {
		return `${base}/api/messages/${encodeURIComponent(messageId)}/rich-blocks/${encodeURIComponent(blockId)}/respond`;
	}

	it("queues the selection as a user message and persists disabled/selectedIds", async () => {
		const threadId = await createThread();
		const messageId = await postRichMessage(threadId);

		const response = await fetch(respondUrl(messageId), {
			method: "POST",
			headers,
			body: JSON.stringify({ selectedIds: ["a"] }),
		});
		expect(response.status).toBe(202);
		const receipt = (await response.json()) as {
			status: string;
			userMessageId: string;
			targetAgentIds: string[];
			blockState: string;
			block: { id: string; disabled: boolean; selectedIds: string[] };
		};
		expect(receipt.status).toBe("queued");
		expect(receipt.targetAgentIds).toEqual(["a1"]);
		expect(receipt.blockState).toBe("persisted");
		expect(receipt.block).toMatchObject({ id: "choose", disabled: true, selectedIds: ["a"] });

		const list = (await fetch(`${base}/api/messages?threadId=${encodeURIComponent(threadId)}`, {
			headers,
		}).then((item) => item.json())) as {
			messages: Array<{
				id: string;
				content: string;
				extra?: { rich?: { blocks: Array<Record<string, unknown>> } };
			}>;
		};
		const original = list.messages.find((message) => message.id === messageId)!;
		expect(original.extra?.rich?.blocks[0]).toMatchObject({ id: "choose", disabled: true, selectedIds: ["a"] });
		const queued = list.messages.find((message) => message.id === receipt.userMessageId)!;
		expect(queued.content).toBe("我选了：方案 A（选一个方案）");
	});

	it("supports custom input and rejects it for options that do not accept it", async () => {
		const threadId = await createThread();
		const messageId = await postRichMessage(threadId);
		const response = await fetch(respondUrl(messageId), {
			method: "POST",
			headers,
			body: JSON.stringify({ selectedIds: ["b"], customInput: "再加一个测试" }),
		});
		expect(response.status).toBe(202);
		const receipt = (await response.json()) as { userMessageId: string };
		const list = (await fetch(`${base}/api/messages?threadId=${encodeURIComponent(threadId)}`, {
			headers,
		}).then((item) => item.json())) as { messages: Array<{ id: string; content: string }> };
		expect(list.messages.find((message) => message.id === receipt.userMessageId)?.content).toBe(
			"方案 B：再加一个测试（选一个方案）",
		);

		const threadId2 = await createThread();
		const messageId2 = await postRichMessage(threadId2);
		const rejected = await fetch(respondUrl(messageId2), {
			method: "POST",
			headers,
			body: JSON.stringify({ selectedIds: ["a"], customInput: "not allowed" }),
		});
		expect(rejected.status).toBe(422);
		expect(((await rejected.json()) as { error: string }).error).toBe("selection_invalid");
	});

	it("rejects disabled blocks, invalid selections, missing CSRF and unknown blocks with typed errors", async () => {
		const threadId = await createThread();
		const messageId = await postRichMessage(threadId);

		const first = await fetch(respondUrl(messageId), {
			method: "POST",
			headers,
			body: JSON.stringify({ selectedIds: ["a"] }),
		});
		expect(first.status).toBe(202);

		const again = await fetch(respondUrl(messageId), {
			method: "POST",
			headers,
			body: JSON.stringify({ selectedIds: ["b"] }),
		});
		expect(again.status).toBe(409);
		expect(((await again.json()) as { error: string }).error).toBe("block_disabled");

		const noCsrf = await fetch(respondUrl(messageId), {
			method: "POST",
			headers: { cookie: headers.cookie!, origin: HUB_ORIGIN, "content-type": "application/json" },
			body: JSON.stringify({ selectedIds: ["a"] }),
		});
		expect(noCsrf.status).toBe(403);

		const threadId2 = await createThread();
		const messageId2 = await postRichMessage(threadId2);
		const badSelection = await fetch(respondUrl(messageId2), {
			method: "POST",
			headers,
			body: JSON.stringify({ selectedIds: ["nope"] }),
		});
		expect(badSelection.status).toBe(422);
		expect(((await badSelection.json()) as { error: string }).error).toBe("selection_invalid");

		const unknownBlock = await fetch(respondUrl(messageId2, "missing"), {
			method: "POST",
			headers,
			body: JSON.stringify({ selectedIds: ["a"] }),
		});
		expect(unknownBlock.status).toBe(404);

		const missingMessage = await fetch(respondUrl("msg:missing"), {
			method: "POST",
			headers,
			body: JSON.stringify({ selectedIds: ["a"] }),
		});
		expect(missingMessage.status).toBe(404);
	});

	it("rejects non-interactive blocks and custom input over the limit", async () => {
		const threadId = await createThread();
		const cardMessage = await postRichMessage(threadId, {
			id: "card1",
			kind: "card",
			v: 1,
			title: "Just a card",
		});
		const cardResponse = await fetch(respondUrl(cardMessage, "card1"), {
			method: "POST",
			headers,
			body: JSON.stringify({ selectedIds: ["a"] }),
		});
		expect(cardResponse.status).toBe(422);
		expect(((await cardResponse.json()) as { error: string }).error).toBe("interactive_invalid");

		const threadId2 = await createThread();
		const messageId = await postRichMessage(threadId2);
		const tooLong = await fetch(respondUrl(messageId), {
			method: "POST",
			headers,
			body: JSON.stringify({ selectedIds: ["b"], customInput: "x".repeat(501) }),
		});
		expect(tooLong.status).toBe(422);
		expect(((await tooLong.json()) as { error: string }).error).toBe("custom_input_too_large");
	});
});
