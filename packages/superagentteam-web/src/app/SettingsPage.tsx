import { useEffect, useState } from "react";

import { AccountsModal } from "@/components/agent/AccountsModal";
import { AgentEditorModal } from "@/components/agent/AgentEditorModal";
import type { AgentView } from "@/domains/agent/api";
import { agentStatusLabel } from "@/domains/agent/labels";
import { useAgentStore } from "@/domains/agent/store";

type SettingsTab = "accounts" | "agents";

export interface SettingsPageProps {
	initialTab?: SettingsTab;
}

function AgentsSettingsPanel() {
	const agents = useAgentStore((state) => state.agents);
	const status = useAgentStore((state) => state.status);
	const error = useAgentStore((state) => state.error);
	const accounts = useAgentStore((state) => state.accounts);
	const accountsStatus = useAgentStore((state) => state.accountsStatus);
	const accountsError = useAgentStore((state) => state.accountsError);
	const loadAccounts = useAgentStore((state) => state.loadAccounts);
	const create = useAgentStore((state) => state.create);
	const update = useAgentStore((state) => state.update);
	const [mode, setMode] = useState<"create" | "edit" | null>(null);
	const [editing, setEditing] = useState<AgentView | undefined>();

	if (mode !== null) {
		return (
			<AgentEditorModal
				open
				variant="page"
				mode={mode}
				agent={editing}
				accounts={accounts}
				accountsStatus={accountsStatus}
				accountsError={accountsError}
				onLoadAccounts={() => void loadAccounts()}
				onClose={() => {
					setMode(null);
					setEditing(undefined);
				}}
				onCreate={create}
				onUpdate={update}
				onSaved={() => {
					setMode(null);
					setEditing(undefined);
				}}
			/>
		);
	}

	return (
		<section className="st-settings-panel" aria-labelledby="st-settings-agents-title">
			<header className="st-settings-section-head">
				<div>
					<h2 id="st-settings-agents-title">Agents</h2>
					<p>选择 account 与 model，设置 @ 名字。创建后可回到对话里直接 @。</p>
				</div>
				<button type="button" className="st-button" onClick={() => setMode("create")}>
					新建 Agent
				</button>
			</header>
			{error ? <p className="st-error" role="alert">{error}</p> : null}
			{status === "loading" && agents.length === 0 ? <p className="st-page-note">正在加载 agents…</p> : null}
			{status === "ready" && agents.length === 0 ? (
				<p className="st-page-note">还没有 agent。先创建一个，再回到对话里 @ 它。</p>
			) : null}
			<div className="st-settings-agent-list">
				{agents.map((agent) => (
					<div className="st-settings-agent-row" key={agent.id}>
						<div className="st-settings-agent-main">
							<strong>{agent.displayName}</strong>
							<span>
								{agent.id} · {agent.accountRef ?? "未绑定 account"} · {agent.defaultModel ?? "未选 model"}
							</span>
						</div>
						<span className="st-settings-agent-state">{agentStatusLabel(agent.status)}</span>
						<button
							type="button"
							className="st-link-button"
							onClick={() => {
								setEditing(agent);
								setMode("edit");
							}}
						>
							编辑
						</button>
					</div>
				))}
			</div>
		</section>
	);
}

export function SettingsPage({ initialTab = "accounts" }: SettingsPageProps) {
	const [tab, setTab] = useState<SettingsTab>(initialTab);
	const load = useAgentStore((state) => state.load);
	const loadAccounts = useAgentStore((state) => state.loadAccounts);
	const agents = useAgentStore((state) => state.agents);
	const agentsStatus = useAgentStore((state) => state.status);
	const accounts = useAgentStore((state) => state.accounts);
	const accountsStatus = useAgentStore((state) => state.accountsStatus);

	useEffect(() => {
		if (agentsStatus === "idle") void load();
		if (accountsStatus === "idle") void loadAccounts();
	}, [agentsStatus, accountsStatus, load, loadAccounts]);

	return (
		<div className="st-settings-page">
			<aside className="st-settings-nav" aria-label="设置导航">
				<div className="st-settings-brand">
					<span className="st-settings-eyebrow">Workspace</span>
					<h1>设置</h1>
					<p>账号与 Agents。配置一次，对话里直接用。</p>
				</div>
				<button
					type="button"
					className={`st-settings-tab${tab === "accounts" ? " is-active" : ""}`}
					onClick={() => setTab("accounts")}
					aria-current={tab === "accounts" ? "page" : undefined}
				>
					<span>账号</span>
					<small>{accounts.length}</small>
				</button>
				<button
					type="button"
					className={`st-settings-tab${tab === "agents" ? " is-active" : ""}`}
					onClick={() => setTab("agents")}
					aria-current={tab === "agents" ? "page" : undefined}
				>
					<span>Agents</span>
					<small>{agents.length}</small>
				</button>
			</aside>
			<section className="st-settings-content" aria-live="polite">
				{tab === "accounts" ? (
					<AccountsModal
						open
						variant="page"
						onClose={() => undefined}
						onChanged={() => void loadAccounts()}
					/>
				) : (
					<AgentsSettingsPanel />
				)}
			</section>
		</div>
	);
}
