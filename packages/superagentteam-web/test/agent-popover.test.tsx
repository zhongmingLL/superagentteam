import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentPopover } from "@/components/agent/AgentPopover";
import type { CreateAgentInput } from "@/domains/agent/api";

const ACCOUNT = { ref: "main", provider: "kimi-coding", models: ["kimi-for-coding"] };

function openForm(onCreate: React.ComponentProps<typeof AgentPopover>["onCreate"]) {
	render(
		<AgentPopover
			agents={[{ id: "a1", displayName: "Agent A1", enabled: true, status: "idle" }]}
			status="ready"
			accounts={[ACCOUNT]}
			accountsStatus="ready"
			onCreate={onCreate}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: /Agents/ }));
	fireEvent.click(screen.getByRole("button", { name: "新建" }));
}

describe("agent popover create form", () => {
	it("creates an agent with normalized mention patterns", async () => {
		const onCreate = vi.fn(async (input: CreateAgentInput) => ({
			id: input.id,
			displayName: input.displayName,
			enabled: true,
		}));
		openForm(onCreate);

		await waitFor(() => expect(screen.getByLabelText("account")).toHaveValue("main"));
		expect(screen.getByLabelText("model")).toHaveValue("kimi-for-coding");
		fireEvent.change(screen.getByLabelText("id"), { target: { value: "a2" } });
		fireEvent.change(screen.getByLabelText("显示名"), { target: { value: "Agent A2" } });
		fireEvent.change(screen.getByLabelText("mention patterns"), { target: { value: "a2, @second" } });
		fireEvent.click(screen.getByRole("button", { name: "创建" }));

		await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
		expect(onCreate).toHaveBeenCalledWith({
			id: "a2",
			displayName: "Agent A2",
			mentionPatterns: ["@a2", "@second"],
			accountRef: "main",
			defaultModel: "kimi-for-coding",
			roleId: "worker",
		});
		expect(await screen.findByText("已创建 Agent A2")).toBeInTheDocument();
	});

	it("shows the typed backend error and keeps the form open", async () => {
		const onCreate = vi.fn(async () => {
			throw new Error("mention_pattern_conflict: pattern @a1 claimed by a1 and a2");
		});
		openForm(onCreate);

		await waitFor(() => expect(screen.getByLabelText("account")).toHaveValue("main"));
		fireEvent.change(screen.getByLabelText("id"), { target: { value: "a2" } });
		fireEvent.change(screen.getByLabelText("显示名"), { target: { value: "Agent A2" } });
		fireEvent.change(screen.getByLabelText("mention patterns"), { target: { value: "@a1" } });
		fireEvent.click(screen.getByRole("button", { name: "创建" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("mention_pattern_conflict");
		expect(screen.getByRole("button", { name: "创建" })).toBeInTheDocument();
	});
});
