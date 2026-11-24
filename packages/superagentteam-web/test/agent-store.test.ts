import { describe, expect, it, vi } from "vitest";

import { createAgentStore } from "@/domains/agent/store";

describe("agent store", () => {
	it("loads global agent status", async () => {
		const api = {
			list: vi.fn(async () => ({
				agents: [{ id: "a1", displayName: "Agent A1", enabled: true, status: "idle" as const }],
			})),
			accounts: vi.fn(async () => ({ accounts: [] })),
			create: vi.fn(),
			update: vi.fn(),
		};
		const store = createAgentStore({ api });

		await store.getState().load();

		expect(store.getState().status).toBe("ready");
		expect(store.getState().agents).toHaveLength(1);
	});

	it("keeps the last agents when refresh fails", async () => {
		const api = {
			list: vi
				.fn()
				.mockResolvedValueOnce({ agents: [{ id: "a1", displayName: "Agent A1", enabled: true }] })
				.mockRejectedValueOnce(new Error("daemon down")),
			accounts: vi.fn(async () => ({ accounts: [] })),
			create: vi.fn(),
			update: vi.fn(),
		};
		const store = createAgentStore({ api });
		await store.getState().load();

		await store.getState().refresh();

		expect(store.getState().agents).toHaveLength(1);
		expect(store.getState()).toMatchObject({ status: "ready", error: "daemon down" });
	});

	it("loads accounts and creates an agent, then refreshes the list", async () => {
		const api = {
			list: vi
				.fn()
				.mockResolvedValueOnce({ agents: [] })
				.mockResolvedValueOnce({
					agents: [{ id: "a1", displayName: "Agent A1", enabled: true, status: "idle" as const }],
				}),
			accounts: vi.fn(async () => ({
				accounts: [
					{
						ref: "main",
						provider: "kimi-coding",
						providerLabel: "Kimi For Coding",
						models: ["kimi-for-coding"],
						credential: { kind: "stored" as const },
						boundAgentIds: [],
					},
				],
			})),
			create: vi.fn(async () => ({
				agent: { id: "a1", displayName: "Agent A1", enabled: true, status: "idle" as const },
			})),
			update: vi.fn(),
		};
		const store = createAgentStore({ api });
		await store.getState().load();
		await store.getState().loadAccounts();

		const created = await store.getState().create({
			id: "a1",
			displayName: "Agent A1",
			mentionPatterns: ["@a1"],
			accountRef: "main",
			defaultModel: "kimi-for-coding",
			roleId: "worker",
		});

		expect(created.id).toBe("a1");
		expect(store.getState().accounts).toHaveLength(1);
		expect(store.getState().agents).toHaveLength(1);
		expect(api.create).toHaveBeenCalledTimes(1);
		expect(api.list).toHaveBeenCalledTimes(2);
	});
});
