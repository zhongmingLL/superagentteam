import type { AgentSession, SessionArtifactView, SessionChainItem, SessionTranscriptEntry } from "@superagentteam/shared/types";
import { useEffect, useId, useState } from "react";

import type { AgentView } from "@/domains/agent/api";
import { agentDisplayName } from "@/domains/agent/labels";
import {
	type SessionApi,
	type SessionDetailResponse,
	type SessionTranscriptResponse,
	sessionApi,
} from "@/domains/session/api";
import { ApiError } from "@/lib/api/client";
import { formatRelative } from "@/lib/time";

export interface SessionChainDialogProps {
	threadId: string;
	agents: AgentView[];
	api?: Pick<SessionApi, "chain" | "detail" | "transcript" | "seal">;
	onClose(): void;
}

function sealError(error: unknown): string {
	if (error instanceof ApiError) {
		if (error.code === "session_active_invocation") return "请先停止该 Agent，再封存会话";
		if (error.code === "session_busy") return "该 Agent 还有排队工作，等它处理完再封存";
		if (error.code === "session_not_active") return "会话状态已变化，请刷新后重试";
		if (error.code === "session_artifact_exists") return "这个会话已经封存过了";
		if (error.code === "session_seal_conflict") return "封存发生竞态，请刷新后重试";
	}
	return error instanceof Error ? error.message : "封存失败，请重试";
}

function statusLabel(status: AgentSession["status"]): string {
	if (status === "active") return "进行中";
	if (status === "sealing") return "封存中";
	return "已封存";
}

function senderLabel(entry: SessionTranscriptEntry): string {
	if (entry.from.kind === "user") return "operator";
	return entry.from.id;
}

export function SessionChainDialog({ threadId, agents, api = sessionApi, onClose }: SessionChainDialogProps) {
	const titleId = useId();
	const [sessions, setSessions] = useState<SessionChainItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | undefined>();
	const [notice, setNotice] = useState<string | undefined>();
	const [detail, setDetail] = useState<SessionDetailResponse | null>(null);
	const [transcript, setTranscript] = useState<SessionTranscriptResponse | null>(null);
	const [inspectingId, setInspectingId] = useState<string | null>(null);
	const [sealingId, setSealingId] = useState<string | null>(null);
	const [confirmSealId, setConfirmSealId] = useState<string | null>(null);

	const loadChain = async (): Promise<void> => {
		try {
			const result = await api.chain(threadId);
			setSessions(result.sessions);
			setError(undefined);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "无法加载 session chain");
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		setLoading(true);
		void loadChain();
	}, [threadId]);

	useEffect(() => {
		const handler = (event: KeyboardEvent) => {
			if (event.key === "Escape" && sealingId === null) onClose();
		};
		document.addEventListener("keydown", handler);
		return () => document.removeEventListener("keydown", handler);
	}, [onClose, sealingId]);

	const inspect = async (sessionId: string): Promise<void> => {
		setInspectingId(sessionId);
		setTranscript(null);
		try {
			setDetail(await api.detail(sessionId));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "无法读取会话详情");
		} finally {
			setInspectingId(null);
		}
	};

	const showTranscript = async (sessionId: string): Promise<void> => {
		setInspectingId(sessionId);
		try {
			const result = await api.transcript(sessionId);
			setDetail({ session: result.session, artifact: result.artifact });
			setTranscript(result);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "无法读取 transcript");
		} finally {
			setInspectingId(null);
		}
	};

	const seal = async (sessionId: string): Promise<void> => {
		setSealingId(sessionId);
		setError(undefined);
		try {
			const result = await api.seal(sessionId, "manual");
			setDetail({ session: result.session, artifact: result.artifact });
			setTranscript(null);
			setConfirmSealId(null);
			setNotice("已封存。下一次调用会自动创建 seq+1 的新 session。");
			await loadChain();
		} catch (cause) {
			setError(sealError(cause));
		} finally {
			setSealingId(null);
		}
	};

	const groups = new Map<string, SessionChainItem[]>();
	for (const session of sessions) {
		const list = groups.get(session.agentId) ?? [];
		list.push(session);
		groups.set(session.agentId, list);
	}

	return (
		<div
			className="st-dialog-backdrop"
			role="presentation"
			onClick={(event) => {
				if (event.target === event.currentTarget && sealingId === null) onClose();
			}}
		>
			<div className="st-dialog st-session-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
				<div className="st-session-dialog-head">
					<h2 id={titleId}>Session chain</h2>
					<button type="button" className="st-link-button" onClick={onClose} disabled={sealingId !== null}>
						关闭
					</button>
				</div>
				<p className="st-field-note">
					每个 agent 的 session 链按 seq 排列。封存会保留 transcript 与确定性摘要；下一次调用自动创建新 session。
				</p>

				{loading ? <p className="st-field-note">正在加载 session chain…</p> : null}
				{error ? (
					<p className="st-error" role="alert">
						{error}
					</p>
				) : null}
				{notice ? (
					<p className="st-session-notice" role="status">
						{notice}
					</p>
				) : null}

				{!loading && sessions.length === 0 ? (
					<p className="st-field-note">还没有 session。第一次向 agent 发消息后会创建。</p>
				) : null}

				{[...groups.entries()].map(([agentId, chain]) => (
					<section className="st-session-group" key={agentId} aria-label={`${agentDisplayName(agents, agentId)} session chain`}>
						<h3>{agentDisplayName(agents, agentId)}</h3>
						<div className="st-session-rows">
							{chain.map((session) => {
								const sealed = session.status === "sealed";
								return (
									<div className={`st-session-row${session.status === "active" ? " is-active" : ""}`} key={session.id}>
										<span className="st-session-seq">#{session.seq}</span>
										<span className={`st-session-status is-${session.status}`}>{statusLabel(session.status)}</span>
										<span className="st-session-count">{session.messageCount} 条</span>
										<span className="st-session-time">
											{formatRelative(sealed && session.sealedAt ? session.sealedAt : session.createdAt)}
										</span>
										{sealed && session.sealReason ? (
											<span className="st-session-reason" title={session.sealReason}>
												{session.sealReason}
											</span>
										) : null}
										<span className="st-session-actions">
											{session.status === "active" ? (
												confirmSealId === session.id ? (
													<>
														<span className="st-session-confirm">确认封存？</span>
														<button
															type="button"
															className="st-session-action is-danger"
															disabled={sealingId !== null}
															onClick={() => void seal(session.id)}
														>
															{sealingId === session.id ? "封存中…" : "确认"}
														</button>
														<button
															type="button"
															className="st-session-action"
															disabled={sealingId !== null}
															onClick={() => setConfirmSealId(null)}
														>
															取消
														</button>
													</>
												) : (
													<button
														type="button"
														className="st-session-action"
														onClick={() => setConfirmSealId(session.id)}
													>
														封存
													</button>
												)
											) : session.hasArtifact ? (
												<>
													<button
														type="button"
														className="st-session-action"
														disabled={inspectingId === session.id}
														onClick={() => void inspect(session.id)}
													>
														摘要
													</button>
													<button
														type="button"
														className="st-session-action"
														disabled={inspectingId === session.id}
														onClick={() => void showTranscript(session.id)}
													>
														Transcript
													</button>
												</>
											) : (
												<span className="st-session-no-artifact">无制品</span>
											)}
										</span>
									</div>
								);
							})}
						</div>
					</section>
				))}

				{detail ? (
					<SessionDetailPanel
						session={detail.session}
						artifact={detail.artifact}
						transcript={transcript}
						agents={agents}
						onCloseDetail={() => {
							setDetail(null);
							setTranscript(null);
						}}
					/>
				) : null}
			</div>
		</div>
	);
}

function SessionDetailPanel({
	session,
	artifact,
	transcript,
	agents,
	onCloseDetail,
}: {
	session: AgentSession;
	artifact: SessionArtifactView | null;
	transcript: SessionTranscriptResponse | null;
	agents: AgentView[];
	onCloseDetail(): void;
}) {
	return (
		<div className="st-session-detail" aria-label="session detail">
			<div className="st-session-detail-head">
				<strong>
					{agentDisplayName(agents, session.agentId)} · #{session.seq} · {statusLabel(session.status)}
				</strong>
				<button type="button" className="st-link-button" onClick={onCloseDetail}>
					收起
				</button>
			</div>
			{artifact === null ? (
				<p className="st-field-note">这是一个 lightweight sealed session，没有 transcript/digest 制品。</p>
			) : (
				<>
					<div className="st-session-digest">
						<span>
							窗口 #{artifact.fromSeq}–#{artifact.toSeq}
							{artifact.digest.window.truncated ? "（已截断，保留最新 400 条）" : ""}
						</span>
						<span>{artifact.messageCount} 条消息</span>
						<span>
							{artifact.transcriptBytes < 1024
								? `${artifact.transcriptBytes} B`
								: `${Math.round(artifact.transcriptBytes / 1024)} KB`}
						</span>
						<span>用户 {artifact.digest.senders.user}</span>
						<span>Agent {Object.values(artifact.digest.senders.agents).reduce((sum, n) => sum + n, 0)}</span>
						<span>错误 {artifact.digest.errors.count}</span>
					</div>
					{artifact.digest.tools.length > 0 ? (
						<p className="st-session-tools">
							工具：{artifact.digest.tools.map((tool) => `${tool.name} ×${tool.count}`).join("、")}
						</p>
					) : null}
					{artifact.digest.recent.length > 0 ? (
						<ul className="st-session-recent">
							{artifact.digest.recent.map((item, index) => (
								<li key={`${item.at}-${index}`}>
									<span>{item.label}</span>
									{item.content}
								</li>
							))}
						</ul>
					) : null}
					{transcript ? (
						<div className="st-session-transcript">
							{transcript.transcript.map((entry) => (
								<article key={entry.seq}>
									<header>
										<span>#{entry.seq}</span>
										<span>{senderLabel(entry)}</span>
									</header>
									<p>{entry.content}</p>
								</article>
							))}
						</div>
					) : null}
				</>
			)}
		</div>
	);
}
