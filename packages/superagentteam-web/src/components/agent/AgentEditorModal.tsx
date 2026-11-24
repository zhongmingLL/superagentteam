import { useEffect, useMemo, useState } from "react";

import type {
	AccountView,
	AgentView,
	CreateAgentInput,
	UpdateAgentInput,
} from "@/domains/agent/api";

export interface AgentEditorModalProps {
	open: boolean;
	mode: "create" | "edit";
	agent?: AgentView;
	accounts: AccountView[];
	accountsStatus: "idle" | "loading" | "ready" | "error";
	accountsError?: string;
	onLoadAccounts?: () => void;
	onClose: () => void;
	onCreate?: (input: CreateAgentInput) => Promise<AgentView>;
	onUpdate?: (id: string, input: UpdateAgentInput) => Promise<AgentView>;
	onSaved?: (agent: AgentView) => void;
}

function splitPatterns(value: string): string[] {
	return value
		.split(/[\s,]+/u)
		.map((item) => item.trim())
		.filter((item) => item !== "")
		.map((item) => (item.startsWith("@") ? item : `@${item}`));
}

function credentialLabel(account: AccountView): string {
	if (account.credential.kind === "stored") return "已存 API Key";
	if (account.credential.kind === "env") return `环境变量 ${account.credential.envName ?? ""}`;
	return "未配置凭据";
}

export function AgentEditorModal({
	open,
	mode,
	agent,
	accounts,
	accountsStatus,
	accountsError,
	onLoadAccounts,
	onClose,
	onCreate,
	onUpdate,
	onSaved,
}: AgentEditorModalProps) {
	const [id, setId] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [mentionPatterns, setMentionPatterns] = useState("");
	const [accountRef, setAccountRef] = useState("");
	const [defaultModel, setDefaultModel] = useState("");
	const [roleId, setRoleId] = useState("worker");
	const [roleDescription, setRoleDescription] = useState("");
	const [enabled, setEnabled] = useState(true);
	const [error, setError] = useState<string | undefined>();
	const [saving, setSaving] = useState(false);

	const selectedAccount = useMemo(
		() => accounts.find((account) => account.ref === accountRef),
		[accounts, accountRef],
	);

	useEffect(() => {
		if (!open) return;
		setError(undefined);
		setSaving(false);
		if (mode === "edit" && agent) {
			setId(agent.id);
			setDisplayName(agent.displayName);
			setMentionPatterns((agent.mentionPatterns ?? []).join(", "));
			setAccountRef(agent.accountRef ?? accounts[0]?.ref ?? "");
			setDefaultModel(agent.defaultModel ?? "");
			setRoleId(agent.roleId ?? "worker");
			setRoleDescription(agent.roleDescription ?? "");
			setEnabled(agent.enabled);
		} else {
			setId("");
			setDisplayName("");
			setMentionPatterns("");
			setAccountRef(accounts[0]?.ref ?? "");
			setDefaultModel(accounts[0]?.models[0] ?? "");
			setRoleId("worker");
			setRoleDescription("");
			setEnabled(true);
		}
	}, [open, mode, agent, accounts]);

	useEffect(() => {
		if (!open || accounts.length > 0) return;
		if (accountsStatus === "idle") onLoadAccounts?.();
	}, [open, accounts.length, accountsStatus, onLoadAccounts]);

	useEffect(() => {
		if (!open || accounts.length === 0) return;
		const current = accounts.find((account) => account.ref === accountRef);
		const next = current ?? accounts[0]!;
		if (next.ref !== accountRef) {
			setAccountRef(next.ref);
			setDefaultModel(next.models[0] ?? "");
			return;
		}
		if (!next.models.includes(defaultModel)) setDefaultModel(next.models[0] ?? "");
	}, [open, accounts, accountRef, defaultModel]);

	if (!open) return null;

	async function submit(): Promise<void> {
		if (saving) return;
		const patterns = splitPatterns(mentionPatterns);
		if (id.trim() === "" || displayName.trim() === "" || patterns.length === 0 || accountRef === "" || defaultModel === "") {
			setError("id、显示名、mention patterns、account 和 model 都是必填。");
			return;
		}
		setSaving(true);
		setError(undefined);
		try {
			let saved: AgentView;
			if (mode === "edit" && agent && onUpdate) {
				saved = await onUpdate(agent.id, {
					displayName: displayName.trim(),
					mentionPatterns: patterns,
					accountRef,
					defaultModel,
					roleId: roleId.trim() || "worker",
					roleDescription: roleDescription.trim(),
					enabled,
				});
			} else if (onCreate) {
				saved = await onCreate({
					id: id.trim(),
					displayName: displayName.trim(),
					mentionPatterns: patterns,
					accountRef,
					defaultModel,
					roleId: roleId.trim() || "worker",
					...(roleDescription.trim() !== "" ? { roleDescription: roleDescription.trim() } : {}),
				});
			} else {
				throw new Error("没有可用的保存入口");
			}
			onSaved?.(saved);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "保存 agent 失败");
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="st-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
			<div className="st-dialog is-wide st-agent-editor" role="dialog" aria-modal="true" aria-labelledby="st-agent-editor-title">
				<div className="st-accounts-head">
					<div>
						<h2 id="st-agent-editor-title">{mode === "create" ? "新建 Agent" : `编辑 ${agent?.displayName ?? ""}`}</h2>
						<p className="st-accounts-sub">account 决定 provider 与凭据；model 跟随 account 的 models。</p>
					</div>
					<button type="button" className="st-button st-button-secondary" onClick={onClose}>
						关闭
					</button>
				</div>
				<form
					className="st-agent-editor-form"
					onSubmit={(event) => {
						event.preventDefault();
						void submit();
					}}
				>
					<section className="st-agent-form-section">
						<h3>模型与接入</h3>
						<label className="st-field">
							<span>account</span>
							<select
								value={accountRef}
								onChange={(event) => setAccountRef(event.target.value)}
								disabled={saving || accounts.length === 0}
							>
								{accounts.length === 0 ? (
									<option value="">{accountsStatus === "loading" ? "加载中…" : "无 account"}</option>
								) : null}
								{accounts.map((account) => (
									<option value={account.ref} key={account.ref}>
										{account.displayName ?? account.ref} ({account.providerLabel})
									</option>
								))}
							</select>
						</label>
						{selectedAccount ? (
							<div className="st-agent-account-card">
								<span className="st-agent-account-provider">{selectedAccount.providerLabel}</span>
								<span className="st-agent-account-credential">{credentialLabel(selectedAccount)}</span>
								{selectedAccount.apiUrl ? <span className="st-agent-account-url">{selectedAccount.apiUrl}</span> : null}
								<div className="st-agent-account-models">
									{selectedAccount.models.map((model) => (
										<span className="st-account-model" key={model}>
											{model}
										</span>
									))}
								</div>
							</div>
						) : null}
						{selectedAccount?.credential.kind === "none" ? (
							<p className="st-agent-credential-warning" role="status">
								该账号还没有凭据，首次运行会失败——可先创建后补 key。
							</p>
						) : null}
						<label className="st-field">
							<span>model</span>
							<select
								value={defaultModel}
								onChange={(event) => setDefaultModel(event.target.value)}
								disabled={saving || !selectedAccount || selectedAccount.models.length === 0}
							>
								{!selectedAccount || selectedAccount.models.length === 0 ? <option value="">无 model</option> : null}
								{selectedAccount?.models.map((model) => (
									<option value={model} key={model}>
										{model}
									</option>
								))}
							</select>
						</label>
						{accountsError ? <p className="st-error">{accountsError}</p> : null}
					</section>
					<section className="st-agent-form-section">
						<h3>@ 名字</h3>
						<div className="st-agent-form-grid">
							<label className="st-field">
								<span>id</span>
								<input
									value={id}
									onChange={(event) => setId(event.target.value)}
									disabled={saving || mode === "edit"}
									placeholder="a2"
									autoComplete="off"
								/>
							</label>
							<label className="st-field">
								<span>显示名</span>
								<input
									value={displayName}
									onChange={(event) => setDisplayName(event.target.value)}
									disabled={saving}
									placeholder="Agent A2"
									autoComplete="off"
								/>
							</label>
						</div>
						<label className="st-field">
							<span>mention patterns</span>
							<input
								value={mentionPatterns}
								onChange={(event) => setMentionPatterns(event.target.value)}
								disabled={saving}
								placeholder="@agentA, @a"
								autoComplete="off"
							/>
						</label>
					</section>
					<section className="st-agent-form-section">
						<h3>身份</h3>
						<div className="st-agent-form-grid">
							<label className="st-field">
								<span>role id</span>
								<input
									value={roleId}
									onChange={(event) => setRoleId(event.target.value)}
									disabled={saving}
									placeholder="worker"
									autoComplete="off"
								/>
							</label>
						</div>
						<label className="st-field">
							<span>角色描述</span>
							<textarea
								value={roleDescription}
								onChange={(event) => setRoleDescription(event.target.value)}
								disabled={saving}
								rows={3}
								placeholder="这个 agent 负责什么"
							/>
						</label>
						{mode === "edit" ? (
							<label className="st-account-radio">
								<input
									type="checkbox"
									checked={enabled}
									onChange={(event) => setEnabled(event.target.checked)}
									disabled={saving}
								/>
								启用
							</label>
						) : null}
					</section>
					{error ? (
						<p className="st-error" role="alert">
							{error}
						</p>
					) : null}
					<div className="st-dialog-actions">
						<button type="button" className="st-button st-button-secondary" onClick={onClose} disabled={saving}>
							取消
						</button>
						<button type="submit" className="st-button" disabled={saving || accounts.length === 0}>
							{saving ? "保存中…" : mode === "create" ? "创建" : "保存"}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
