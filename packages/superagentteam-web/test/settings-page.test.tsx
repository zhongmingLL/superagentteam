import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsPage } from "@/app/SettingsPage";
import { accountApi } from "@/domains/account/api";
import { useAgentStore } from "@/domains/agent/store";

vi.mock("@/domains/account/api", () => ({
	accountApi: {
		list: vi.fn(async () => ({ accounts: [] })),
		providers: vi.fn(async () => ({ providers: [] })),
		create: vi.fn(),
		update: vi.fn(),
		remove: vi.fn(),
	},
}));

const ACCOUNT = {
	ref: "main",
	provider: "kimi-coding",
	providerLabel: "Kimi For Coding",
	models: ["kimi-for-coding"],
	credential: { kind: "stored" as const },
	boundAgentIds: ["a1"],
};

function resetStore(): void {
	useAgentStore.setState({
		agents: [],
		status: "ready",
		error: undefined,
		accounts: [],
		accountsStatus: "ready",
		accountsError: undefined,
		load: vi.fn(async () => {}),
		refresh: vi.fn(async () => true),
		loadAccounts: vi.fn(async () => {}),
		create: vi.fn(),
		update: vi.fn(),
	});
}

afterEach(resetStore);

describe("settings page", () => {
	it("lists agents and opens the page editor", () => {
		useAgentStore.setState({
			agents: [
				{
					id: "a1",
					displayName: "Agent A1",
					enabled: true,
					status: "idle",
					accountRef: "main",
					defaultModel: "kimi-for-coding",
				},
			],
			accounts: [ACCOUNT],
		});
		render(
			<MemoryRouter>
				<SettingsPage initialTab="agents" />
			</MemoryRouter>,
		);

		expect(screen.getByText("Agent A1")).toBeInTheDocument();
		expect(screen.getByText(/a1 · main/)).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "新建 Agent" }));
		expect(screen.getByRole("heading", { name: "新建 Agent" })).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "返回列表" }));
		expect(screen.getByText("Agent A1")).toBeInTheDocument();
	});

	it("switches between accounts and agents sections", () => {
		render(
			<MemoryRouter>
				<SettingsPage initialTab="agents" />
			</MemoryRouter>,
		);

		expect(screen.getByRole("button", { name: /^Agents/ })).toHaveAttribute("aria-current", "page");
		fireEvent.click(screen.getByRole("button", { name: /^账户与登录/ }));
		expect(screen.getByRole("button", { name: /^账户与登录/ })).toHaveAttribute("aria-current", "page");
	});

	it("shows GLM model suggestions for the Z.AI provider", async () => {
		vi.mocked(accountApi.providers).mockResolvedValueOnce({
			providers: [
				{
					id: "zai",
					label: "Z.AI / 智谱 GLM",
					envName: "ZAI_API_KEY",
					supportsBaseUrl: true,
					suggestedModels: ["glm-5.2", "glm-4.7"],
				},
			],
		});
		render(
			<MemoryRouter>
				<SettingsPage initialTab="accounts" />
			</MemoryRouter>,
		);
		const create = await screen.findByRole("button", { name: "新建账号" });
		await waitFor(() => expect(create).toBeEnabled());
		fireEvent.click(create);
		const suggestion = await screen.findByRole("button", { name: "+ glm-5.2" });
		fireEvent.click(suggestion);
		expect(screen.getByText("glm-5.2")).toBeInTheDocument();
	});
});
