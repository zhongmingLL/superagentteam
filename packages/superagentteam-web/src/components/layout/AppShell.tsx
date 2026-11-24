import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";

import { AgentPopover } from "@/components/agent/AgentPopover";
import { useThreadStore } from "@/domains/thread/store";
import { useNewThreadDialog } from "@/domains/thread/dialog-store";
import { useAgentStore } from "@/domains/agent/store";
import { applyTheme, readTheme, type Theme } from "@/lib/theme";
import { ThreadSidebar } from "@/components/threads/ThreadSidebar";
import { NewThreadDialog } from "@/components/threads/NewThreadDialog";
import { NavRail } from "@/components/layout/NavRail";
import { Icon } from "@/components/ui/Icon";
import { usePolling } from "@/lib/polling";

function threadIdFromPath(pathname: string): string | undefined {
	const prefix = "/thread/";
	if (!pathname.startsWith(prefix)) return undefined;
	try {
		return decodeURIComponent(pathname.slice(prefix.length));
	} catch {
		return undefined;
	}
}

export function AppShell() {
	const refresh = useThreadStore((state) => state.refresh);
	const threads = useThreadStore((state) => state.threads);
	const detail = useThreadStore((state) => state.detail);
	const refreshAgents = useAgentStore((state) => state.refresh);
	const loadAgents = useAgentStore((state) => state.load);
	const agents = useAgentStore((state) => state.agents);
	const agentStatus = useAgentStore((state) => state.status);
	const agentError = useAgentStore((state) => state.error);
	const accounts = useAgentStore((state) => state.accounts);
	const accountsStatus = useAgentStore((state) => state.accountsStatus);
	const accountsError = useAgentStore((state) => state.accountsError);
	const loadAccounts = useAgentStore((state) => state.loadAccounts);
	const createAgent = useAgentStore((state) => state.create);
	const updateAgent = useAgentStore((state) => state.update);
	const location = useLocation();
	const navigate = useNavigate();
	const dialogOpen = useNewThreadDialog((state) => state.open);
	const hideDialog = useNewThreadDialog((state) => state.hide);
	const [sidebarOpen, setSidebarOpen] = useState(() => !window.matchMedia("(max-width: 900px)").matches);
	const [agentSignal, setAgentSignal] = useState(0);
	const [theme, setTheme] = useState<Theme>(() => readTheme());
	const activeThreadId = threadIdFromPath(location.pathname);
	const activeThread = detail?.id === activeThreadId ? detail : threads.find((thread) => thread.id === activeThreadId);

	usePolling(refresh, { intervalMs: 10_000 });
	usePolling(refreshAgents, { intervalMs: 10_000 });

	useEffect(() => {
		applyTheme(theme);
	}, [theme]);

	useEffect(() => {
		if (window.matchMedia("(max-width: 900px)").matches) setSidebarOpen(false);
	}, [location.pathname]);

	useEffect(() => {
		const mobile = window.matchMedia("(max-width: 900px)");
		const onChange = (event: MediaQueryListEvent): void => {
			if (event.matches) setSidebarOpen(false);
		};
		mobile.addEventListener("change", onChange);
		return () => mobile.removeEventListener("change", onChange);
	}, []);

	return (
		<div className="st-shell">
			<NavRail
				onAgents={() => setAgentSignal((value) => value + 1)}
				theme={theme}
				onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
			/>
			<ThreadSidebar
				open={sidebarOpen}
				onClose={() => setSidebarOpen(false)}
				onAgents={() => {
					setSidebarOpen(false);
					setAgentSignal((value) => value + 1);
				}}
			/>
			{sidebarOpen ? (
				<button
					type="button"
					className="st-sidebar-backdrop"
					aria-label="关闭对话列表遮罩"
					onClick={() => setSidebarOpen(false)}
				/>
			) : null}
			<main className="st-main">
				<header className="st-topbar">
					<button type="button" className="st-icon-button st-menu-button" onClick={() => setSidebarOpen(true)} aria-label="打开侧栏">
						<Icon name="menu" size={18} />
					</button>
					<div className="st-topbar-crumb">
						<Link className="st-topbar-root" to="/">
							Threads
						</Link>
						{activeThread ? (
							<>
								<Icon name="chevron" size={12} />
								<span className="st-topbar-title">{activeThread.title ?? "未命名对话"}</span>
							</>
						) : null}
					</div>
					<div className="st-topbar-actions">
						<button
							type="button"
							className="st-icon-button st-theme-button"
							aria-label={theme === "dark" ? "切换浅色主题" : "切换深色主题"}
							onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
						>
							<Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
						</button>
						<AgentPopover
							agents={agents}
							status={agentStatus}
							error={agentError}
							onRetry={() => void loadAgents()}
							accounts={accounts}
							accountsStatus={accountsStatus}
							accountsError={accountsError}
							onLoadAccounts={() => void loadAccounts()}
							onCreate={createAgent}
							onUpdate={updateAgent}
							openSignal={agentSignal}
						/>
					</div>
				</header>
				<div className="st-content">
					<Outlet />
				</div>
			</main>
			<NewThreadDialog
				open={dialogOpen}
				onClose={hideDialog}
				onCreated={(thread) => {
					hideDialog();
					setSidebarOpen(false);
					navigate(`/thread/${encodeURIComponent(thread.id)}`);
				}}
			/>
		</div>
	);
}
