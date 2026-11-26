import { useEffect, useMemo, useState } from "react";

import type {
	AccountView,
	AgentView,
	CreateAgentInput,
	UpdateAgentInput,
} from "@/domains/agent/api";
import { initialForName } from "@/lib/identity";

export interface AgentEditorModalProps {
	open: boolean;
	mode: "create" | "edit";
	agent?: AgentView;
	accounts: AccountView[];
	accountsStatus: "idle" | "loading" | "ready" | "error";
	accountsError?: string;
	onLoadAccounts?: () => void;
	onOpenAccounts?: () => void;
	onClose: () => void;
	onCreate?: (input: CreateAgentInput) => Promise<AgentView>;
	onUpdate?: (id: string, input: UpdateAgentInput) => Promise<AgentView>;
	onSaved?: (agent: AgentView) => void;
	variant?: "dialog" | "page";
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
	onOpenAccounts,
	onClose,
	onCreate,
	onUpdate,
	onSaved,
	variant = "dialog",
}: AgentEditorModalProps) {
	const page = variant === "page";
	const [id, setId] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [mentionPatterns, setMentionPatterns] = useState<string[]>([]);
	const [mentionDraft, setMentionDraft] = useState("");
	const [accountRef, setAccountRef] = useState("");
	const [defaultModel, setDefaultModel] = useState("");
	const [roleId, setRoleId] = useState("worker");
	const [roleDescription, setRoleDescription] = useState("");
	const [enabled, setEnabled] = useState(true);
	const [avatar, setAvatar] = useState("");
	const [color, setColor] = useState("#2563EB");
	const [section, setSection] = useState<"identity" | "account">("identity");
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
			setMentionPatterns([...(agent.mentionPatterns ?? [])]);
			setMentionDraft("");
			setAccountRef(agent.accountRef ?? accounts[0]?.ref ?? "");
			setDefaultModel(agent.defaultModel ?? "");
			setRoleId(agent.roleId ?? "worker");
			setRoleDescription(agent.roleDescription ?? "");
			setEnabled(agent.enabled);
			setAvatar(agent.avatar ?? "");
			setColor(agent.color?.primary ?? "#2563EB");
			setSection("identity");
		} else {
			setId("");
			setDisplayName("");
			setMentionPatterns([]);
			setMentionDraft("");
			setAccountRef(accounts[0]?.ref ?? "");
			setDefaultModel(accounts[0]?.models[0] ?? "");
			setRoleId("worker");
			setRoleDescription("");
			setEnabled(true);
			setAvatar("");
			setColor("#2563EB");
			setSection("identity");
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

	function addMention(): void {
		const raw = mentionDraft.trim();
		if (raw === "") return;
		const pattern = raw.startsWith("@") ? raw : `@${raw}`;
		setMentionPatterns((current) => (current.includes(pattern) ? current : [...current, pattern]));
		setMentionDraft("");
	}

	async function submit(): Promise<void> {
		if (saving) return;
		const patterns = mentionPatterns;
		if (displayName.trim() === "" || patterns.length === 0 || accountRef === "" || defaultModel === "") {
			setError("显示名、呼叫别名、account 和 model 都是必填。");
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
					...(avatar.trim() !== "" ? { avatar: avatar.trim() } : { avatar: null }),
					color: { primary: color, secondary: color },
				});
			} else if (onCreate) {
				saved = await onCreate({
					displayName: displayName.trim(),
					mentionPatterns: patterns,
					accountRef,
					defaultModel,
					roleId: roleId.trim() || "worker",
					...(roleDescription.trim() !== "" ? { roleDescription: roleDescription.trim() } : {}),
					enabled,
					...(avatar.trim() !== "" ? { avatar: avatar.trim() } : {}),
					color: { primary: color, secondary: color },
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
		<div
			className={page ? "st-settings-panel-wrap" : "st-dialog-backdrop"}
			onMouseDown={page ? undefined : (event) => event.target === event.currentTarget && onClose()}
		>
			<div
				className={page ? "st-settings-panel st-agent-editor" : "st-dialog is-wide st-agent-editor"}
				role={page ? "region" : "dialog"}
				aria-modal={page ? undefined : true}
				aria-labelledby="st-agent-editor-title"
			>
				<div className="st-accounts-head">
					<div>
						<h2 id="st-agent-editor-title">{mode === "create" ? "新建 Agent" : `编辑 ${agent?.displayName ?? ""}`}</h2>
						<p className="st-accounts-sub">account 决定 provider 与凭据；model 跟随 account 的 models。</p>
					</div>
					<button type="button" className="st-button st-button-secondary" onClick={onClose}>
						{page ? "返回列表" : "关闭"}
					</button>
				</div>
				<form
					className="st-agent-editor-form"
					onSubmit={(event) => {
						event.preventDefault();
						void submit();
					}}
				>
					<div className={page ? "st-agent-editor-body" : "st-agent-editor-sections"}>
					{page ? (
						<nav className="st-agent-section-nav" aria-label="Agent 分区">
							<button
								type="button"
								className={section === "identity" ? "is-active" : ""}
								onClick={() => setSection("identity")}
							>
								身份与职责
							</button>
							<button
								type="button"
								className={section === "account" ? "is-active" : ""}
								onClick={() => setSection("account")}
							>
								Account 与模型
							</button>
						</nav>
					) : null}
					<div className="st-agent-editor-sections">
					{!page || section === "account" ? (
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
							{accounts.length === 0 && accountsStatus === "ready" ? (
								<div className="st-agent-empty-accounts">
									<span>还没有账号。Agent 需要先绑定一个 provider 账号。</span>
									<button
										type="button"
										className="st-link-button"
										onClick={() => {
											onOpenAccounts?.();
											onClose();
										}}
									>
										去「Accounts」新建
									</button>
								</div>
							) : null}
							<label className="st-account-radio">
								<input
									type="checkbox"
									checked={enabled}
									onChange={(event) => setEnabled(event.target.checked)}
									disabled={saving}
								/>
								启用
							</label>
					</section>
					) : null}
					{!page || section === "identity" ? (
					<>
					<section className="st-agent-form-section">
						<h3>身份与职责</h3>
						{mode === "edit" ? <p className="st-field-note">标识：{id}（由系统生成）</p> : null}
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
						<label className="st-field">
							<span>呼叫别名</span>
							<div className="st-model-editor">
								{mentionPatterns.map((pattern) => (
									<span className="st-model-chip" key={pattern}>
										{pattern}
										<button
											type="button"
											aria-label={`移除 ${pattern}`}
											onClick={() =>
												setMentionPatterns((current) => current.filter((item) => item !== pattern))
											}
											disabled={saving}
										>
											×
										</button>
									</span>
								))}
								<input
									value={mentionDraft}
									onChange={(event) => setMentionDraft(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											addMention();
										}
									}}
									disabled={saving}
									placeholder="@agentA"
									aria-label="呼叫别名"
									autoComplete="off"
								/>
								<button
									type="button"
									className="st-button st-button-secondary"
									onClick={addMention}
									disabled={saving || mentionDraft.trim() === ""}
								>
									添加
								</button>
							</div>
						</label>
					</section>
					<section className="st-agent-form-section">
						<h3>角色与外观</h3>
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
						<div className="st-field">
							<span>头像 URL（可选）</span>
							<div className="st-agent-avatar-row">
								<span
									className="st-agent-avatar-preview"
									style={avatar !== "" ? { backgroundImage: `url(${avatar})` } : undefined}
									aria-hidden="true"
								>
									{avatar === "" ? initialForName(displayName) || "A" : ""}
								</span>
								<input
									value={avatar}
									onChange={(event) => setAvatar(event.target.value)}
									disabled={saving}
									placeholder="https://…"
									autoComplete="off"
								/>
							</div>
						</div>
						<div className="st-field">
							<span>成员主色</span>
							<div className="st-agent-color-row">
								<input
									type="color"
									value={color}
									onChange={(event) => setColor(event.target.value)}
									disabled={saving}
								/>
								<span className="st-agent-color-hex">{color}</span>
								<span className="st-field-note">以后用于该成员的聊天气泡/背景</span>
							</div>
						</div>
					</section>
					</>
					) : null}
					</div>
					</div>
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
