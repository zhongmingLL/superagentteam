import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { QueueStrip } from "@/components/a2a/QueueStrip";
import type { LiveInvocationView, QueueEntryView } from "@/domains/a2a/api";
import type { AgentView } from "@/domains/agent/api";

const agents: AgentView[] = [
	{ id: "a1", displayName: "Agent A1", enabled: true, status: "idle" },
	{ id: "a2", displayName: "Agent A2", enabled: true, status: "working" },
];

describe("queue strip", () => {
	it("renders queued target, position and state", () => {
		render(
			<QueueStrip
				agents={agents}
				cap={20}
				queue={[
					{
						queueEntryId: "queue:1",
						sourceRecordId: "msg:1",
						status: "queued",
						priority: "normal",
						position: 0,
						targetAgentIds: ["a1"],
						claimedBy: null,
						enqueuedAt: 1,
						updatedAt: 1,
					},
				]}
			/>,
		);

		expect(screen.getByLabelText("消息队列")).toBeInTheDocument();
		expect(screen.getByText("#1")).toBeInTheDocument();
		expect(screen.getByText("Agent A1")).toBeInTheDocument();
		expect(screen.getByText("排队中")).toBeInTheDocument();
		expect(screen.getByText("每个对话：消息最多 20 条、agent 唤醒最多 20 条（v1 固定）")).toBeInTheDocument();
	});

	it("is hidden when the queue is empty", () => {
		const { container } = render(<QueueStrip agents={agents} queue={[]} />);
		expect(container).toBeEmptyDOMElement();
	});

	it("shows 处理这条 only for queued entries and submits interrupt on an idle target", async () => {
		const onSteer = vi.fn(async () => {});
		const entry = queueEntry({ targetAgentIds: ["a2"] });
		render(<QueueStrip agents={agents} queue={[entry]} live={[]} onSteer={onSteer} />);

		expect(screen.getByRole("button", { name: "处理这条排队消息" })).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "处理这条排队消息" }));
		expect(screen.getByRole("dialog")).toBeInTheDocument();

		const guide = screen.getByLabelText("接进当前回复") as HTMLInputElement;
		expect(guide.disabled).toBe(true);
		fireEvent.click(screen.getByLabelText("停下并处理这条"));
		fireEvent.click(screen.getByRole("button", { name: "确认处理" }));

		await waitFor(() => expect(onSteer).toHaveBeenCalledWith("queue:1", "a2", "interrupt"));
	});

	it("defaults an active target to guide and submits it", async () => {
		const onSteer = vi.fn(async () => {});
		render(
			<QueueStrip
				agents={agents}
				queue={[queueEntry({ targetAgentIds: ["a1"] })]}
				live={[liveInvocation()]}
				onSteer={onSteer}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "处理这条排队消息" }));
		expect((screen.getByLabelText("接进当前回复") as HTMLInputElement).disabled).toBe(false);
		fireEvent.click(screen.getByRole("button", { name: "确认处理" }));
		await waitFor(() => expect(onSteer).toHaveBeenCalledWith("queue:1", "a1", "guide"));
	});

	it("does not offer 处理这条 for a claimed entry", () => {
		render(<QueueStrip agents={agents} queue={[queueEntry({ status: "claimed" })]} onSteer={vi.fn()} />);
		expect(screen.queryByRole("button", { name: "处理这条排队消息" })).not.toBeInTheDocument();
	});
});

function queueEntry(overrides: Partial<QueueEntryView> = {}): QueueEntryView {
	return {
		queueEntryId: "queue:1",
		sourceRecordId: "msg:1",
		status: "queued",
		priority: "normal",
		position: 0,
		targetAgentIds: ["a1"],
		claimedBy: null,
		enqueuedAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

function liveInvocation(overrides: Partial<LiveInvocationView> = {}): LiveInvocationView {
	return {
		agentId: "a1",
		turnExecutionId: "turn:1",
		parentInvocationId: "inv:1",
		startedAt: 1,
		childStatus: "running",
		responseStatus: "missing",
		evidenceRank: "record+tracker",
		...overrides,
	};
}
