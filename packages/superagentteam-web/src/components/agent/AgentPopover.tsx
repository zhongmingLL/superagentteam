import { type FormEvent, useEffect, useRef, useState } from "react";

import type { AccountView, AgentView, CreateAgentInput } from "@/domains/agent/api";
import { agentStatusLabel } from "@/domains/agent/labels";
import { Icon } from "@/components/ui/Icon";

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
	openSignal?: number;
}

function splitPatterns(value: string): string[] {
	return value
		.split(/[\s,]+/u)
		.map((item) => item.trim())
		.filter((item) => item !== "")
		.map((item) => (item.startsWith("@") ? item : `@${item}`));
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
	openSignal = 0,
}: AgentPopoverProps) {
	const [open, setOpen] = useState(false);
	const [showCreate, setShowCreate] = useState(false);
	const [id, setId] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [mentionPatterns, setMentionPatterns] = useState("");
	const [accountRef, setAccountRef] = useState("");
	const [defaultModel, setDefaultModel] = useState("");
	const [roleId, setRoleId] = useState("worker");
	const [roleDescription, setRoleDescription] = useState("");
	const [busy, setBusy] = useState(false);
	const [formError, setFormError] = useState<string | undefined>();
	const [createdName, setCreatedName] = useState<string | undefined>();
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

	useEffect(() => {
		if (openSignal > 0) setOpen(true);
	}, [openSignal]);

	useEffect(() => {
		if (!open || !showCreate) return;
		if (accounts.length === 0) {
			if (accountsStatus === "idle") onLoadAccounts?.();
			return;
		}
		const selected = accounts.find((account) => account.ref === accountRef) ?? accounts[0]!;
		if (selected.ref !== accountRef) {
			setAccountRef(selected.ref);
			return;
		}
		if (!selected.models.includes(defaultModel)) setDefaultModel(selected.models[0] ?? "");
	}, [open, showCreate, accounts, accountsStatus, accountRef, defaultModel, onLoadAccounts]);

	const resetForm = (): void => {
		setId("");
		setDisplayName("");
		setMentionPatterns("");
		setRoleId("worker");
		setRoleDescription("");
		setFormError(undefined);
	};

	const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
		event.preventDefault();
		if (busy || !onCreate) return;
		const patterns = splitPatterns(mentionPatterns);
		if (!id.trim() || !displayName.trim() || patterns.length === 0 || !accountRef || !defaultModel) {
			setFormError("id、显示名、mention patterns、account 和 model 都是必填。 ");
			return;
		}
		setBusy(true);
		setFormError(undefined);
		try {
			const created = await onCreate({
				id: id.trim(),
				displayName: displayName.trim(),
				mentionPatterns: patterns,
				accountRef,
				defaultModel,
				roleId: roleId.trim() || "worker",
				...(roleDescription.trim() !== "" ? { roleDescription: roleDescription.trim() } : {}),
			});
			setCreatedName(created.displayName);
			setShowCreate(false);
			resetForm();
		} catch (caught) {
			setFormError(caught instanceof Error ? caught.message : "创建 agent 失败");
		} finally {
			setBusy(false);
		}
	};

	const account = accounts.find((item) => item.ref === accountRef);

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
						{onCreate ? (
							<button
								type="button"
								className="st-link-button"
								onClick={() => {
									setShowCreate((value) => !value);
									setFormError(undefined);
									setCreatedName(undefined);
								}}
							>
								{showCreate ? "收起" : "新建"}
							</button>
						) : null}
					</div>
					{createdName ? (
						<p className="st-agent-created" role="status">
							已创建 {createdName}
						</p>
					) : null}
					{showCreate ? (
						<form className="st-agent-form" onSubmit={(event) => void submit(event)}>
							<label>
								id
								<input value={id} onChange={(event) => setId(event.target.value)} disabled={busy} required />
							</label>
							<label>
								显示名
								<input
									value={displayName}
									onChange={(event) => setDisplayName(event.target.value)}
									disabled={busy}
									required
								/>
							</label>
							<label>
								mention patterns
								<input
									value={mentionPatterns}
									onChange={(event) => setMentionPatterns(event.target.value)}
									placeholder="@agentA, @a"
									disabled={busy}
									required
								/>
							</label>
							<label>
								account
								<select
									value={accountRef}
									onChange={(event) => setAccountRef(event.target.value)}
									disabled={busy || accounts.length === 0}
								>
									{accounts.length === 0 ? <option value="">{accountsStatus === "loading" ? "加载中…" : "无 account"}</option> : null}
									{accounts.map((item) => (
										<option value={item.ref} key={item.ref}>
											{item.ref} ({item.provider})
										</option>
									))}
								</select>
							</label>
							<label>
								model
								<select
									value={defaultModel}
									onChange={(event) => setDefaultModel(event.target.value)}
									disabled={busy || !account || account.models.length === 0}
								>
									{!account || account.models.length === 0 ? <option value="">无 model</option> : null}
									{account?.models.map((model) => (
										<option value={model} key={model}>
											{model}
										</option>
									))}
								</select>
							</label>
							<label>
								role id
								<input value={roleId} onChange={(event) => setRoleId(event.target.value)} disabled={busy} />
							</label>
							<label>
								角色描述
								<input
									value={roleDescription}
									onChange={(event) => setRoleDescription(event.target.value)}
									disabled={busy}
								/>
							</label>
							{accountsError ? <p className="st-error">{accountsError}</p> : null}
							{formError ? (
								<p className="st-error" role="alert">
									{formError}
								</p>
							) : null}
							<button type="submit" className="st-button" disabled={busy || accounts.length === 0}>
								{busy ? "创建中…" : "创建"}
							</button>
						</form>
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
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}
