import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsPage } from "@/app/SettingsPage";
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
});
