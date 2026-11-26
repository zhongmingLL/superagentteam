import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThreadSidebar } from "@/components/threads/ThreadSidebar";
import type { ThreadView } from "@/domains/thread/api";
import { useNewThreadDialog } from "@/domains/thread/dialog-store";
import { useThreadStore } from "@/domains/thread/store";

function thread(overrides: Partial<ThreadView> = {}): ThreadView {
	return {
		id: "thread:1",
		projectPath: "/tmp/project-a",
		title: "Alpha",
		titleSource: "user",
		createdBy: "operator:1",
		participants: [],
		lastActiveAt: Date.now(),
		createdAt: Date.now(),
		updatedAt: Date.now(),
		deletedAt: null,
		...overrides,
	};
}

afterEach(() => {
	useThreadStore.setState({
		threads: [],
		status: "ready",
		error: undefined,
		query: "",
		load: vi.fn(async () => {}),
		refresh: vi.fn(async () => true),
		create: vi.fn(),
		rename: vi.fn(async (threadId: string, title: string) => ({ ...thread({ id: threadId }), title })),
	});
});

describe("thread sidebar", () => {
	it("lists threads and filters by search", () => {
		useThreadStore.setState({
			threads: [thread(), thread({ id: "thread:2", title: "Beta", projectPath: "/tmp/b" })],
			status: "ready",
		});
		render(
			<MemoryRouter>
				<ThreadSidebar open onClose={() => {}} />
			</MemoryRouter>,
		);

		expect(screen.getByText("Alpha")).toBeInTheDocument();
		expect(screen.getByText("Beta")).toBeInTheDocument();
		expect(screen.queryByText(/conversations · local dev/)).not.toBeInTheDocument();
		fireEvent.change(screen.getByLabelText("搜索对话"), { target: { value: "beta" } });
		expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
		expect(screen.getByText("Beta")).toBeInTheDocument();
	});

	it("shows an accessible unread count on a thread row", () => {
		useThreadStore.setState({
			threads: [thread({ unreadCount: 3 })],
			status: "ready",
		});
		render(
			<MemoryRouter>
				<ThreadSidebar open onClose={() => {}} />
			</MemoryRouter>,
		);

		expect(screen.getByLabelText("3 条未读")).toHaveTextContent("3");
	});

	it("renames a thread from the row more-actions menu", async () => {
		const rename = vi.fn(async (threadId: string, title: string) => ({ ...thread({ id: threadId }), title }));
		useThreadStore.setState({ threads: [thread()], status: "ready", rename });
		render(
			<MemoryRouter>
				<ThreadSidebar open onClose={() => {}} />
			</MemoryRouter>,
		);

		fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "重命名对话" }));
		const input = screen.getByLabelText("对话名");
		fireEvent.change(input, { target: { value: "Beta" } });
		fireEvent.keyDown(input, { key: "Enter" });

		await waitFor(() => expect(rename).toHaveBeenCalledWith("thread:1", "Beta"));
	});

	it("cancels inline rename on Escape", async () => {
		const rename = vi.fn(async (threadId: string, title: string) => ({ ...thread({ id: threadId }), title }));
		useThreadStore.setState({ threads: [thread()], status: "ready", rename });
		render(
			<MemoryRouter>
				<ThreadSidebar open onClose={() => {}} />
			</MemoryRouter>,
		);

		fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "重命名对话" }));
		const input = screen.getByLabelText("对话名");
		fireEvent.change(input, { target: { value: "Beta" } });
		fireEvent.keyDown(input, { key: "Escape" });

		expect(screen.queryByLabelText("对话名")).not.toBeInTheDocument();
		expect(rename).not.toHaveBeenCalled();
	});

	it("shows an inline error when rename fails", async () => {
		const rename = vi.fn(async () => {
			throw new Error("重命名失败");
		});
		useThreadStore.setState({ threads: [thread()], status: "ready", rename });
		render(
			<MemoryRouter>
				<ThreadSidebar open onClose={() => {}} />
			</MemoryRouter>,
		);

		fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "重命名对话" }));
		const input = screen.getByLabelText("对话名");
		fireEvent.change(input, { target: { value: "Beta" } });
		fireEvent.keyDown(input, { key: "Enter" });

		expect(await screen.findByRole("alert")).toHaveTextContent("重命名失败");
	});

	it("exposes the settings entry in the mobile navigation", () => {
		useThreadStore.setState({ threads: [], status: "ready", query: "" });
		render(
			<MemoryRouter>
				<ThreadSidebar open onClose={() => {}} />
			</MemoryRouter>,
		);

		const settings = screen.getByRole("link", { name: "Settings" });
		expect(settings).toHaveAttribute("href", "/settings");
	});

	it("shows the empty state and opens the new-thread dialog", () => {
		useThreadStore.setState({ threads: [], status: "ready", query: "" });
		render(
			<MemoryRouter>
				<ThreadSidebar open onClose={() => {}} />
			</MemoryRouter>,
		);

		expect(screen.getByText("还没有对话。点「新对话」开始。")).toBeInTheDocument();
		const newThread = screen.getByRole("button", { name: "新对话" });
		expect(newThread.textContent).toBe("新对话");
		fireEvent.click(newThread);
		expect(useNewThreadDialog.getState().open).toBe(true);
		useNewThreadDialog.setState({ open: false });
	});
});
