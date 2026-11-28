import { useEffect, useId, useMemo, useState } from "react";

import type { AgentView } from "@/domains/agent/api";
import { agentDisplayName } from "@/domains/agent/labels";
import type { LiveInvocationView, QueueEntryView, SteerMode } from "@/domains/a2a/api";

export interface SteerAction {
	targetAgentId: string;
	mode: SteerMode;
}

export interface SteerQueueDialogProps {
	entry: QueueEntryView;
	agents: AgentView[];
	live: LiveInvocationView[];
	onCancel(): void;
	onConfirm(actions: SteerAction[]): Promise<void>;
}

export function SteerQueueDialog({ entry, agents, live, onCancel, onConfirm }: SteerQueueDialogProps) {
	const titleId = useId();
	const activeAgentIds = useMemo(() => new Set(live.map((item) => item.agentId)), [live]);
	const targets = entry.targetAgentIds;
	const [selected, setSelected] = useState<Set<string>>(() => new Set(targets));
	const [modeByTarget, setModeByTarget] = useState<Record<string, SteerMode>>(() =>
		Object.fromEntries(targets.map((id) => [id, activeAgentIds.has(id) ? "guide" : "interrupt"])),
	);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | undefined>();

	useEffect(() => {
		const handler = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !submitting) onCancel();
		};
		document.addEventListener("keydown", handler);
		return () => document.removeEventListener("keydown", handler);
	}, [onCancel, submitting]);

	const actions: SteerAction[] = targets
		.filter((id) => selected.has(id))
		.map((id) => ({ targetAgentId: id, mode: modeByTarget[id] ?? "interrupt" }));
	const hasInvalidGuide = actions.some((action) => action.mode === "guide" && !activeAgentIds.has(action.targetAgentId));
	const canSubmit = actions.length > 0 && !hasInvalidGuide && !submitting;

	const toggle = (agentId: string) => {
		setSelected((current) => {
			const next = new Set(current);
			if (next.has(agentId)) next.delete(agentId);
			else next.add(agentId);
			return next;
		});
	};

	const setMode = (agentId: string, mode: SteerMode) => {
		if (mode === "guide" && !activeAgentIds.has(agentId)) return;
		setModeByTarget((current) => ({ ...current, [agentId]: mode }));
	};

	const submit = async () => {
		if (!canSubmit) return;
		setSubmitting(true);
		setError(undefined);
		try {
			await onConfirm(actions);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "处理失败，请重试");
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div
			className="st-dialog-backdrop"
			role="presentation"
			onClick={(event) => {
				if (event.target === event.currentTarget && !submitting) onCancel();
			}}
		>
			<div className="st-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
				<h2 id={titleId}>处理这条排队消息</h2>
				<p className="st-field-note">
					选择要立即处理的成员：「接进当前回复」不会打断正在运行的回合；「停下并处理这条」会取消当前回合并用这条消息重新开始。
				</p>

				<div className="st-steer-targets">
					{targets.map((agentId) => {
						const active = activeAgentIds.has(agentId);
						const checked = selected.has(agentId);
						const mode = modeByTarget[agentId] ?? "interrupt";
						return (
							<div className="st-steer-target" key={agentId}>
								<label className="st-steer-target-name">
									<input type="checkbox" checked={checked} onChange={() => toggle(agentId)} />
									<span>{agentDisplayName(agents, agentId)}</span>
									<span className={`st-queue-state${active ? " is-claimed" : ""}`}>
										{active ? "运行中" : "空闲"}
									</span>
								</label>
								<div className="st-steer-modes" role="radiogroup" aria-label={`${agentDisplayName(agents, agentId)} 的处理方式`}>
									<label className={!active ? "is-disabled" : undefined}>
										<input
											type="radio"
											name={`steer-mode-${agentId}`}
											checked={mode === "guide"}
											disabled={!active || !checked}
											onChange={() => setMode(agentId, "guide")}
										/>
										<span>接进当前回复</span>
									</label>
									<label>
										<input
											type="radio"
											name={`steer-mode-${agentId}`}
											checked={mode === "interrupt"}
											disabled={!checked}
											onChange={() => setMode(agentId, "interrupt")}
										/>
										<span>停下并处理这条</span>
									</label>
								</div>
							</div>
						);
					})}
				</div>

				{hasInvalidGuide ? (
					<p className="st-error" role="alert">
						有成员已不在运行中，请改选「停下并处理这条」。
					</p>
				) : null}
				{error ? (
					<p className="st-error" role="alert">
						{error}
					</p>
				) : null}

				<div className="st-dialog-actions">
					<button type="button" className="st-button st-button-secondary" onClick={onCancel} disabled={submitting}>
						取消
					</button>
					<button type="button" className="st-button" onClick={() => void submit()} disabled={!canSubmit}>
						{submitting ? "处理中…" : `确认处理${actions.length > 1 ? `（${actions.length}）` : ""}`}
					</button>
				</div>
			</div>
		</div>
	);
}
