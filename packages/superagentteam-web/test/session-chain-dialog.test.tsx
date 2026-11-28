import type { AgentSession, SessionArtifactView, SessionChainItem, SessionDigestV1 } from "@superagentteam/shared/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AgentView } from "@/domains/agent/api";
import { SessionChainDialog } from "@/components/session/SessionChainDialog";
import { ApiError } from "@/lib/api/client";

const agents: AgentView[] = [{ id: "a1", displayName: "Agent A1", enabled: true, status: "idle" }];

function session(overrides: Partial<SessionChainItem> = {}): SessionChainItem {
	return {
		id: "sess:1",
		threadId: "t1",
		agentId: "a1",
		userId: "u1",
		seq: 0,
		lastCountedTurnExecutionId: null,
		status: "active",
		piSessionId: null,
		piSessionFile: null,
		workingDirectory: "/p",
		messageCount: 2,
		consecutiveResumeFailures: 0,
		sealReason: null,
		createdAt: 1_000,
		updatedAt: 1_000,
		sealedAt: null,
		hasArtifact: false,
		...overrides,
	};
}

function digest(overrides: Partial<SessionDigestV1> = {}): SessionDigestV1 {
	return {
		v: 1,
		sessionId: "sess:1",
		threadId: "t1",
		agentId: "a1",
		seq: 0,
		createdAt: 1_000,
		sealedAt: 2_000,
		sealReason: "manual",
		window: { fromSeq: 1, toSeq: 2, messageCount: 2, truncated: false },
		senders: { user: 1, agents: { a1: 1 }, system: 0 },
		tools: [{ name: "post_message", count: 1 }],
		errors: { count: 0, samples: [] },
		firstUserMessage: "hello",
		lastUserMessage: "hello",
		lastAgentMessage: "done",
		recent: [
			{ role: "user", label: "operator", content: "hello", at: 1_100 },
			{ role: "agent", label: "a1", content: "done", at: 1_200 },
		],
		...overrides,
	};
}

function artifact(overrides: Partial<SessionArtifactView> = {}): SessionArtifactView {
	return {
		sessionId: "sess:1",
		threadId: "t1",
		agentId: "a1",
		seq: 0,
		sealedAt: 2_000,
		sealReason: "manual",
		fromSeq: 1,
		toSeq: 2,
		messageCount: 2,
		transcriptBytes: 2_048,
		createdAt: 2_000,
		digest: digest(),
		transcript: [
			{ seq: 1, at: 1_100, from: { kind: "user", id: "operator" }, content: "hello" },
			{ seq: 2, at: 1_200, from: { kind: "agent", id: "a1" }, content: "done" },
		],
		...overrides,
	};
}

describe("session chain dialog", () => {
	it("seals an active session and shows the resulting digest", async () => {
		const active = session();
		const sealed = session({ status: "sealed", sealReason: "manual", sealedAt: 2_000, hasArtifact: true });
		const api = {
			chain: vi
				.fn()
				.mockResolvedValueOnce({ threadId: "t1", sessions: [active] })
				.mockResolvedValueOnce({ threadId: "t1", sessions: [sealed] }),
			detail: vi.fn(),
			transcript: vi.fn(),
			seal: vi.fn(async () => ({ session: sealed as AgentSession, artifact: artifact() })),
		};
		render(<SessionChainDialog threadId="t1" agents={agents} api={api} onClose={() => {}} />);
		expect(await screen.findByText("Agent A1")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "封存" }));
		expect(screen.getByText("确认封存？")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "确认" }));

		await waitFor(() => expect(api.seal).toHaveBeenCalledWith("sess:1", "manual"));
		await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已封存"));
		expect(screen.getByText(/窗口 #1–#2/)).toBeInTheDocument();
		expect(screen.getByText("工具：post_message ×1")).toBeInTheDocument();
	});

	it("inspects a sealed session digest and transcript", async () => {
		const sealed = session({ status: "sealed", sealReason: "manual", sealedAt: 2_000, hasArtifact: true });
		const api = {
			chain: vi.fn(async () => ({ threadId: "t1", sessions: [sealed] })),
			detail: vi.fn(async () => ({ session: sealed as AgentSession, artifact: artifact() })),
			transcript: vi.fn(async () => ({
				session: sealed as AgentSession,
				artifact: artifact(),
				transcript: artifact().transcript,
			})),
			seal: vi.fn(),
		};
		render(<SessionChainDialog threadId="t1" agents={agents} api={api} onClose={() => {}} />);
		await screen.findByText("Agent A1");
		fireEvent.click(screen.getByRole("button", { name: "摘要" }));
		await waitFor(() => expect(api.detail).toHaveBeenCalledWith("sess:1"));
		expect(screen.getByText(/窗口 #1–#2/)).toBeInTheDocument();
		expect(screen.getByText("hello")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Transcript" }));
		await waitFor(() => expect(api.transcript).toHaveBeenCalledWith("sess:1"));
		expect(screen.getByText("#2")).toBeInTheDocument();
		expect(screen.getAllByText("done").length).toBeGreaterThan(0);
	});

	it("marks a lightweight sealed session without artifacts", async () => {
		const sealed = session({ status: "sealed", sealReason: "resume_circuit_breaker", sealedAt: 2_000 });
		const api = {
			chain: vi.fn(async () => ({ threadId: "t1", sessions: [sealed] })),
			detail: vi.fn(async () => ({ session: sealed as AgentSession, artifact: null })),
			transcript: vi.fn(),
			seal: vi.fn(),
		};
		render(<SessionChainDialog threadId="t1" agents={agents} api={api} onClose={() => {}} />);
		await screen.findByText("Agent A1");
		expect(screen.getByText("无制品")).toBeInTheDocument();
	});

	it("maps a busy seal error to an operator-facing message", async () => {
		const api = {
			chain: vi.fn(async () => ({ threadId: "t1", sessions: [session()] })),
			detail: vi.fn(),
			transcript: vi.fn(),
			seal: vi.fn(async () => {
				throw new ApiError(409, "session_active_invocation", "busy", {});
			}),
		};
		render(<SessionChainDialog threadId="t1" agents={agents} api={api} onClose={() => {}} />);
		await screen.findByText("Agent A1");
		fireEvent.click(screen.getByRole("button", { name: "封存" }));
		fireEvent.click(screen.getByRole("button", { name: "确认" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("请先停止该 Agent");
	});
});
