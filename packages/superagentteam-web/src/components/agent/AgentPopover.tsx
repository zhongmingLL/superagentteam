import { useEffect, useRef, useState } from "react";

import type {
	AccountView,
	AgentView,
	CreateAgentInput,
	UpdateAgentInput,
} from "@/domains/agent/api";
import { agentStatusLabel } from "@/domains/agent/labels";
import { Icon } from "@/components/ui/Icon";
import { AccountsModal } from "./AccountsModal";
import { AgentEditorModal } from "./AgentEditorModal";

export interface AgentPopoverProps {
	agents: AgentView[];
	status: "idle" | "loading" | "ready" | "error";
	error?: string;
	onRetry?: () => void;
	accounts?: AccountView[];
	accountsStatus?: "idle" | "loading" | "ready" | "error";
	accountsError?: string;
	onLoadAccounts?: () => void;
	onCreate?: (input: CreateAgentInput) => Promise<AgentView>;
	onUpdate?: (id: string, input: UpdateAgentInput) => Promise<AgentView>;
}

export function AgentPopover({
	agents,
	status,
	error,
	onRetry,
	accounts = [],
	accountsStatus = "idle",
	accountsError,
	onLoadAccounts,
	onCreate,
	onUpdate,
}: AgentPopoverProps) {
	const [open, setOpen] = useState(false);
	const [accountsOpen, setAccountsOpen] = useState(false);
	const [editorOpen, setEditorOpen] = useState(false);
	const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
	const [editingAgent, setEditingAgent] = useState<AgentView | undefined>();
	const [notice, setNotice] = useState<string | undefined>();
	const rootRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent): void => {
			if (event.key === "Escape") setOpen(false);
		};
		const onPointer = (event: MouseEvent): void => {
			if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener("keydown", onKey);
		document.addEventListener("mousedown", onPointer);
		return () => {
			document.removeEventListener("keydown", onKey);
			document.removeEventListener("mousedown", onPointer);
		};
	}, [open]);


	function openCreate(): void {
		setNotice(undefined);
		setEditingAgent(undefined);
		setEditorMode("create");
		setEditorOpen(true);
	}

	function openEdit(agent: AgentView): void {
		setNotice(undefined);
		setEditingAgent(agent);
		setEditorMode("edit");
		setEditorOpen(true);
	}

	return (
		<div className="st-agent-popover" ref={rootRef}>
			<button
				type="button"
				className="st-icon-button st-agent-button"
				aria-expanded={open}
				aria-haspopup="dialog"
				onClick={() => setOpen((value) => !value)}
			>
				<Icon name="agents" size={14} />
				<span>Agents</span>
				{agents.length > 0 ? <span className="st-agent-count">{agents.length}</span> : null}
			</button>
			{open ? (
				<div className="st-agent-panel" role="dialog" aria-label="Agents">
					<div className="st-agent-panel-header">
						<span>Agents</span>
						<span className="st-agent-panel-actions">
							<button type="button" className="st-link-button" onClick={() => setAccountsOpen(true)}>
								账号
							</button>
							{onCreate ? (
								<button type="button" className="st-link-button" onClick={openCreate}>
									新建
								</button>
							) : null}
						</span>
					</div>
					{notice ? (
						<p className="st-agent-created" role="status">
							{notice}
						</p>
					) : null}
					{status === "loading" && agents.length === 0 ? <p className="st-page-note">正在加载 agents…</p> : null}
					{status === "ready" && agents.length === 0 ? <p className="st-page-note">还没有注册的 agent。</p> : null}
					{status === "error" ? (
						<div className="st-agent-error">
							<p className="st-error">{error ?? "无法加载 agents"}</p>
							{onRetry ? (
								<button type="button" className="st-link-button" onClick={onRetry}>
									重试
								</button>
							) : null}
						</div>
					) : null}
					{agents.map((agent) => (
						<div className="st-agent-row" key={agent.id}>
							<span className={`st-agent-dot is-${agent.status ?? "unknown"}`} aria-hidden="true" />
							<span className="st-agent-name" title={agent.id}>
								{agent.displayName}
							</span>
							<span className="st-agent-status">{agentStatusLabel(agent.status)}</span>
							{onUpdate ? (
								<button type="button" className="st-link-button st-agent-edit" onClick={() => openEdit(agent)}>
									编辑
								</button>
							) : null}
						</div>
					))}
				</div>
			) : null}
			<AccountsModal
				open={accountsOpen}
				onClose={() => setAccountsOpen(false)}
				onChanged={() => onLoadAccounts?.()}
			/>
			<AgentEditorModal
				open={editorOpen}
				mode={editorMode}
				agent={editingAgent}
				accounts={accounts}
				accountsStatus={accountsStatus}
				accountsError={accountsError}
				onLoadAccounts={onLoadAccounts}
				onClose={() => {
					setEditorOpen(false);
					setEditingAgent(undefined);
				}}
				onCreate={onCreate}
				onUpdate={onUpdate}
				onSaved={(agent) => {
					setNotice(`${editorMode === "create" ? "已创建" : "已保存"} ${agent.displayName}`);
					setEditorOpen(false);
					setEditingAgent(undefined);
				}}
			/>
		</div>
	);
}
