import { useEffect, useMemo, useRef, useState } from "react";

import {
	type AccountProviderView,
	type AccountView,
	accountApi,
} from "@/domains/account/api";
import { ApiError } from "@/lib/api/client";
import { initialForName } from "@/lib/identity";

export interface AccountsModalProps {
	open: boolean;
	onClose: () => void;
	onChanged?: () => void;
	variant?: "dialog" | "page";
}

type FormMode = "create" | "edit";
type CredentialMode = "stored" | "env";

interface FormState {
	ref: string;
	displayName: string;
	provider: string;
	models: string[];
	modelDraft: string;
	apiUrl: string;
	credentialMode: CredentialMode;
	apiKey: string;
	envName: string;
}

function emptyForm(provider?: AccountProviderView): FormState {
	return {
		ref: "",
		displayName: "",
		provider: provider?.id ?? "",
		models: [],
		modelDraft: "",
		apiUrl: "",
		credentialMode: "stored",
		apiKey: "",
		envName: provider?.envName ?? "",
	};
}

function formFromAccount(account: AccountView): FormState {
	return {
		ref: account.ref,
		displayName: account.displayName ?? "",
		provider: account.provider,
		models: [...account.models],
		modelDraft: "",
		apiUrl: account.apiUrl ?? "",
		credentialMode: account.credential.kind === "env" ? "env" : "stored",
		apiKey: "",
		envName: account.credential.envName ?? "",
	};
}

function credentialLabel(account: AccountView): string {
	if (account.credential.kind === "stored") return "已存 API Key";
	if (account.credential.kind === "env") return `环境变量 ${account.credential.envName ?? ""}`;
	return "未配置凭据";
}

export function AccountsModal({ open, onClose, onChanged, variant = "dialog" }: AccountsModalProps) {
	const page = variant === "page";
	const [accounts, setAccounts] = useState<AccountView[]>([]);
	const [providers, setProviders] = useState<AccountProviderView[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | undefined>();
	const [mode, setMode] = useState<FormMode | null>(null);
	const [form, setForm] = useState<FormState>({ ...emptyForm() });
	const [saving, setSaving] = useState(false);
	const dialogRef = useRef<HTMLDivElement>(null);
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	const provider = useMemo(
		() => providers.find((item) => item.id === form.provider),
		[providers, form.provider],
	);
	const selectableProviders = providers.filter((item) => item.selectable !== false);

	async function refresh(): Promise<void> {
		setLoading(true);
		setError(undefined);
		try {
			const [accountBody, providerBody] = await Promise.all([accountApi.list(), accountApi.providers()]);
			setAccounts(accountBody.accounts);
			setProviders(providerBody.providers);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "加载账号失败");
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		if (!open) return;
		void refresh();
		setMode(null);
		setError(undefined);
	}, [open]);

	useEffect(() => {
		if (!open || page) return;
		const onKey = (event: KeyboardEvent): void => {
			if (event.key === "Escape") onCloseRef.current();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, page]);

	if (!open) return null;

	const patch = (next: Partial<FormState>): void => setForm((current) => ({ ...current, ...next }));

	function startCreate(): void {
		setMode("create");
		const defaultProvider =
			providers.find((item) => item.id === "kimi-coding" && item.selectable !== false) ??
			selectableProviders[0] ??
			providers[0];
		setForm(emptyForm(defaultProvider));
		setError(undefined);
	}

	function startEdit(account: AccountView): void {
		setMode("edit");
		setForm(formFromAccount(account));
		setError(undefined);
	}

	async function save(): Promise<void> {
		if (saving) return;
		const models = form.models;
		if (form.provider === "") {
			setError("请选择 provider");
			return;
		}
		if (models.length === 0) {
			setError("至少填写一个 model");
			return;
		}
		if (form.credentialMode === "stored" && mode === "create" && form.apiKey.trim() === "") {
			setError("请填写 API Key，或改用环境变量");
			return;
		}
		if (form.credentialMode === "env" && form.envName.trim() === "") {
			setError("请填写环境变量名");
			return;
		}
		setSaving(true);
		setError(undefined);
		try {
			const input = {
				...(mode === "create" ? { ref: form.ref.trim() } : {}),
				...(form.displayName.trim() !== "" ? { displayName: form.displayName.trim() } : {}),
				provider: form.provider,
				...(form.apiUrl.trim() !== "" ? { apiUrl: form.apiUrl.trim() } : {}),
				models,
				...(form.credentialMode === "stored" && form.apiKey.trim() !== ""
					? { apiKey: form.apiKey.trim() }
					: {}),
				...(form.credentialMode === "env" ? { envName: form.envName.trim() } : {}),
			};
			if (mode === "create") await accountApi.create(input);
			else await accountApi.update(form.ref, input);
			await refresh();
			setMode(null);
			onChanged?.();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "保存账号失败");
		} finally {
			setSaving(false);
		}
	}

	function addModel(): void {
		const model = form.modelDraft.trim();
		if (model === "") return;
		patch({
			models: form.models.includes(model) ? form.models : [...form.models, model],
			modelDraft: "",
		});
	}

	async function remove(account: AccountView): Promise<void> {
		if (!window.confirm(`删除账号 ${account.displayName ?? account.ref}？`)) return;
		setError(undefined);
		try {
			await accountApi.remove(account.ref);
			await refresh();
			onChanged?.();
		} catch (caught) {
			if (caught instanceof ApiError && caught.code === "account_in_use") {
				const body = caught.body as { agentIds?: string[] } | undefined;
				setError(`账号仍被 ${body?.agentIds?.join("、") ?? "agent"} 使用，先解绑再删。`);
			} else {
				setError(caught instanceof Error ? caught.message : "删除账号失败");
			}
		}
	}

	return (
		<div
			className={page ? "st-settings-panel-wrap" : "st-dialog-backdrop"}
			onMouseDown={page ? undefined : (event) => event.target === event.currentTarget && onClose()}
		>
			<div
				ref={dialogRef}
				className={page ? "st-settings-panel" : "st-dialog is-wide"}
				role={page ? "region" : "dialog"}
				aria-modal={page ? undefined : true}
				aria-labelledby="st-accounts-title"
			>
				<div className="st-accounts-head">
					<div>
						<h2 id="st-accounts-title">账户与登录</h2>
						<p className="st-accounts-sub">
							provider、模型与凭据。API Key 只写入，不回显；凭据绑定到账户，agent 通过账户取模型。
						</p>
					</div>
					<div className="st-accounts-head-actions">
						{mode === null ? (
							<button
								type="button"
								className="st-button"
								onClick={startCreate}
								disabled={selectableProviders.length === 0}
							>
								新建账号
							</button>
						) : null}
						{page ? null : (
							<button type="button" className="st-button st-button-secondary" onClick={onClose}>
								关闭
							</button>
						)}
					</div>
				</div>
				{error ? <p className="st-error" role="alert">{error}</p> : null}
				{loading ? <p className="st-page-note">正在加载账号…</p> : null}
				{mode === null ? (
					<div className="st-account-list">
						{accounts.length === 0 && !loading ? (
							<p className="st-page-note">还没有账号。新建一个 provider 账号后，agent 就能选择它。</p>
						) : null}
						{accounts.map((account) => (
							<div className="st-account-row" key={account.ref}>
								<span className="st-account-avatar" aria-hidden="true">
									{initialForName(account.displayName ?? account.ref)}
								</span>
								<div className="st-account-main">
									<div className="st-account-title">
										<strong>{account.displayName ?? account.ref}</strong>
										<span className="st-account-ref">{account.ref}</span>
									</div>
									<div className="st-account-meta">
										{account.providerLabel} · {credentialLabel(account)}
										{account.apiUrl ? ` · ${account.apiUrl}` : ""}
									</div>
									<div className="st-account-models">
										{account.models.map((model) => (
											<span className="st-account-model" key={model}>
												{model}
											</span>
										))}
									</div>
									{account.boundAgentIds.length > 0 ? (
										<div className="st-account-bound">绑定：{account.boundAgentIds.join("、")}</div>
									) : null}
								</div>
								<div className="st-account-actions">
									<button type="button" className="st-link-button" onClick={() => startEdit(account)}>
										编辑
									</button>
									<button type="button" className="st-link-button is-danger" onClick={() => void remove(account)}>
										删除
									</button>
								</div>
							</div>
						))}
						{accounts.length > 0 ? (
							<p className="st-account-summary">
								{accounts.length} 个账户 ·{" "}
								{new Set(accounts.flatMap((account) => account.boundAgentIds)).size} 个 agent 使用中
							</p>
						) : null}
					</div>
				) : (
					<form
						className="st-account-form"
						onSubmit={(event) => {
							event.preventDefault();
							void save();
						}}
					>
						{mode === "edit" ? <p className="st-field-note">标识：{form.ref}（由系统生成）</p> : null}
						<div className="st-account-form-grid">
							<label className="st-field">
								<span>显示名（可选）</span>
								<input
									value={form.displayName}
									onChange={(event) => patch({ displayName: event.target.value })}
									disabled={saving}
									placeholder="Kimi Main"
									autoComplete="off"
								/>
							</label>
							<label className="st-field">
								<span>Provider</span>
								<select
									value={form.provider}
									onChange={(event) => {
										const next = providers.find((item) => item.id === event.target.value);
										patch({
											provider: event.target.value,
											envName: next?.envName ?? form.envName,
										});
									}}
									disabled={saving}
								>
									{providers.map((item) => (
										<option value={item.id} key={item.id} disabled={item.selectable === false}>
											{item.label} ({item.id}){item.selectable === false ? " — 需特殊认证" : ""}
										</option>
									))}
								</select>
								{providers.some((item) => item.selectable === false) ? (
									<span className="st-field-note">标“需特殊认证”的 provider 将在后续版本支持。</span>
								) : null}
							</label>
							<label className="st-field">
								<span>Base URL（可选）</span>
								<input
									value={form.apiUrl}
									onChange={(event) => patch({ apiUrl: event.target.value })}
									disabled={saving}
									placeholder="https://api.example.com/v1"
									autoComplete="off"
								/>
							</label>
						</div>
						<div className="st-field">
							<span>Models</span>
							<div className="st-model-editor">
								{form.models.map((model) => (
									<span className="st-model-chip" key={model}>
										{model}
										<button
											type="button"
											aria-label={`移除 ${model}`}
											onClick={() =>
												patch({ models: form.models.filter((item) => item !== model) })
											}
											disabled={saving}
										>
											×
										</button>
									</span>
								))}
								<input
									value={form.modelDraft}
									onChange={(event) => patch({ modelDraft: event.target.value })}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											addModel();
										}
									}}
									disabled={saving}
									placeholder="添加 model"
									autoComplete="off"
								/>
								<button
									type="button"
									className="st-button st-button-secondary"
									onClick={addModel}
									disabled={saving || form.modelDraft.trim() === ""}
								>
									添加
								</button>
							</div>
							{provider && (provider.suggestedModels?.length ?? 0) > 0 ? (
								<div className="st-model-suggestions">
									<span className="st-field-note">常用模型</span>
									{(provider.suggestedModels ?? [])
										.filter((model) => !form.models.includes(model))
										.map((model) => (
											<button
												type="button"
												className="st-model-suggestion"
												key={model}
												onClick={() => patch({ models: [...form.models, model] })}
												disabled={saving}
											>
												+ {model}
											</button>
										))}
								</div>
							) : null}
						</div>
						<div className="st-account-credential">
							<span className="st-account-credential-label">凭据</span>
							<label className="st-account-radio">
								<input
									type="radio"
									name="credential-mode"
									checked={form.credentialMode === "stored"}
									onChange={() => patch({ credentialMode: "stored" })}
									disabled={saving}
								/>
								API Key
							</label>
							<label className="st-account-radio">
								<input
									type="radio"
									name="credential-mode"
									checked={form.credentialMode === "env"}
									onChange={() => patch({ credentialMode: "env" })}
									disabled={saving}
								/>
								环境变量
							</label>
						</div>
						{form.credentialMode === "stored" ? (
							<label className="st-field">
								<span>{mode === "edit" ? "API Key（留空保留现有）" : "API Key"}</span>
								<input
									type="password"
									autoComplete="new-password"
									value={form.apiKey}
									onChange={(event) => patch({ apiKey: event.target.value })}
									disabled={saving}
									placeholder={mode === "edit" ? "••••••••" : "sk-…"}
								/>
							</label>
						) : (
							<label className="st-field">
								<span>环境变量名</span>
								<input
									value={form.envName}
									onChange={(event) => patch({ envName: event.target.value })}
									disabled={saving}
									placeholder={provider?.envName ?? "PROVIDER_API_KEY"}
									autoComplete="off"
								/>
							</label>
						)}
						<div className="st-dialog-actions">
							<button
								type="button"
								className="st-button st-button-secondary"
								onClick={() => setMode(null)}
								disabled={saving}
							>
								取消
							</button>
							<button type="submit" className="st-button" disabled={saving || selectableProviders.length === 0}>
								{saving ? "保存中…" : mode === "create" ? "创建账号" : "保存"}
							</button>
						</div>
					</form>
				)}
			</div>
		</div>
	);
}
