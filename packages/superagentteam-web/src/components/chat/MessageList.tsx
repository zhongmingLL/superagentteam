import { useEffect, useRef, useState } from "react";

import type { LiveInvocationView } from "@/domains/a2a/api";
import type { MessageView } from "@/domains/chat/api";
import type { LiveExecutionMap, LiveExecutionState } from "@/domains/events/execution-store";
import type { ThreadView } from "@/domains/thread/api";
import { initialForName, toneFor } from "@/lib/identity";
import { formatElapsed, formatRelative } from "@/lib/time";
import { MessageExecutionRecord } from "./MessageExecutionRecord";
import { MessageContent } from "./MessageContent";
import { RichBlocks, type RichBlockRespondHandler } from "./RichBlocks";

export interface PendingUserMessageView {
	messageId: string;
	content: string;
}

export interface MessageListProps {
	thread: ThreadView;
	messages: MessageView[];
	status: "idle" | "loading" | "ready" | "error";
	error?: string;
	hasMore: boolean;
	loadingOlder: boolean;
	followingLatest: boolean;
	pendingUserMessages: PendingUserMessageView[];
	liveInvocations?: LiveInvocationView[];
	liveExecutions?: LiveExecutionMap;
	agentLabel?: (agentId: string) => string;
	threadLabel?: (threadId: string) => string;
	onOpenThread?: (threadId: string) => void;
	onLoadOlder: () => void;
	onRetry: () => void;
	onRetryInvocation?: (invocationId: string) => Promise<void>;
	onResumeLatest: () => void;
	onRichBlockRespond?: RichBlockRespondHandler;
}

function senderLabel(message: MessageView, agentLabel?: (agentId: string) => string): string {
	if (message.from.kind === "user") return "operator";
	if (message.from.kind === "agent") return agentLabel?.(message.from.agentId) ?? message.from.agentId;
	return message.from.service;
}

function isProcessing(message: MessageView): boolean {
	return message.lifecycle?.kind === "response" && message.lifecycle.status === "processing";
}

function terminalStatus(message: MessageView): { label: string; status: string } | null {
	if (message.lifecycle?.kind !== "response") return null;
	if (message.lifecycle.status === "failed") return { label: "回复失败", status: "failed" };
	if (message.lifecycle.status === "interrupted") return { label: "已中断", status: "interrupted" };
	if (message.lifecycle.status === "canceled") return { label: "已取消", status: "canceled" };
	return null;
}

function retryableInvocationId(message: MessageView): string | null {
	if (message.lifecycle?.kind !== "response") return null;
	if (message.lifecycle.status !== "failed" && message.lifecycle.status !== "interrupted") return null;
	return message.lifecycle.parentInvocationId;
}

function DispatchTargets({
	message,
	agentLabel,
}: {
	message: MessageView;
	agentLabel?: (agentId: string) => string;
}) {
	const refs = message.lifecycle?.kind === "input" ? message.lifecycle.dispatchRefs : [];
	const targets = [
		...(message.extra?.targetAgentIds ?? []),
		...refs.map((ref) => ref.target.id),
	].filter((targetId, index, all) => all.indexOf(targetId) === index);
	if (message.from.kind !== "agent" || targets.length === 0) return null;
	const phases = targets.map((targetId) => refs.find((ref) => ref.target.id === targetId)?.phase);
	const settled = phases.filter((phase) => phase === "settled").length;
	const stateLabel = settled === targets.length ? "已回复" : settled > 0 ? "部分已回复" : "已送达";
	return (
		<div className="st-message-dispatch" data-testid="message-dispatch-targets">
			<span className="st-dispatch-caption">发送给</span>
			{targets.map((targetId) => {
				const label = agentLabel?.(targetId) ?? targetId;
				return (
					<span className="st-dispatch-target" key={targetId}>
						<span className={`st-dispatch-avatar tone-${toneFor(targetId)}`} aria-hidden="true">
							{initialForName(label)}
						</span>
						<span>{label}</span>
					</span>
				);
			})}
			<span className="st-dispatch-state">{stateLabel}</span>
		</div>
	);
}

function privateA2ARecipients(message: MessageView): string[] {
	if (message.from.kind !== "agent") return [];
	if (message.extra?.crossPost || message.extra?.multiMention) return [];
	return [...new Set(message.extra?.targetAgentIds ?? [])];
}

function crossPostRecipients(message: MessageView): string[] {
	if (message.from.kind !== "agent") return [];
	const refs = message.lifecycle?.kind === "input" ? message.lifecycle.dispatchRefs : [];
	return [
		...new Set([
			...(message.extra?.targetAgentIds ?? []),
			...refs.filter((ref) => ref.target.kind === "agent").map((ref) => ref.target.id),
		]),
	];
}

function privateA2ADeliveryState(message: MessageView, recipients: readonly string[]): string {
	const refs = message.lifecycle?.kind === "input" ? message.lifecycle.dispatchRefs : [];
	const settled = recipients.filter(
		(targetId) => refs.find((ref) => ref.target.id === targetId)?.phase === "settled",
	).length;
	if (settled === recipients.length) return "已回复";
	return settled > 0 ? "部分已回复" : "已送达";
}

interface MultiMentionRowView {
	targetAgentId: string;
	status: string;
	content: string;
	reason?: string | null;
}

function extractMultiMentionQuestion(content: string): string {
	return content.match(/^Question:\s*(.+)$/m)?.[1]?.trim() ?? "";
}

function multiMentionRows(message: MessageView, messagesById: ReadonlyMap<string, MessageView>): MultiMentionRowView[] {
	const multiMention = message.extra?.multiMention;
	const parsed = new Map<string, string>();
	for (const line of message.content.split("\n")) {
		const match = line.match(/^- ([^ ]+) \[([^\]]+)\]: ?(.*)$/);
		if (match) parsed.set(match[1], match[3] ?? "");
	}
	const responses = Array.isArray(multiMention?.responses) ? multiMention.responses : [];
	const targetIds =
		responses.length > 0
			? responses.map((response) => response.targetAgentId)
			: (multiMention?.targetAgentIds ?? [...parsed.keys()]);
	return [...new Set(targetIds)].map((targetAgentId) => {
		const response = responses.find((candidate) => candidate.targetAgentId === targetAgentId);
		const responseMessage =
			response?.responseMessageId !== null && response?.responseMessageId !== undefined
				? messagesById.get(response.responseMessageId)
				: undefined;
		return {
			targetAgentId,
			status: response?.status ?? (parsed.has(targetAgentId) ? "received" : "pending"),
			content: responseMessage?.content ?? parsed.get(targetAgentId) ?? "",
			reason: response?.reason ?? null,
		};
	});
}

function multiMentionStatusLabel(status: string): string {
	if (status === "received") return "已回复";
	if (status === "timeout") return "超时";
	if (status === "failed") return "失败";
	if (status === "pending") return "等待";
	return status;
}

function MultiMentionCard({
	message,
	messagesById,
	agentLabel,
}: {
	message: MessageView;
	messagesById: ReadonlyMap<string, MessageView>;
	agentLabel?: (agentId: string) => string;
}) {
	const [expanded, setExpanded] = useState(false);
	const multiMention = message.extra?.multiMention;
	const rows = multiMentionRows(message, messagesById);
	const question = extractMultiMentionQuestion(message.content);
	const received = rows.filter((row) => row.status === "received").length;
	const callbackLabel = multiMention?.callbackTo ? (agentLabel?.(multiMention.callbackTo) ?? multiMention.callbackTo) : "发起者";
	const hasContent = rows.some((row) => row.content.trim() !== "");
	return (
		<div className="st-multi-mention-card" data-testid="multi-mention-card">
			<div className="st-mm-head">
				<span className="st-mm-title">Multi-Mention</span>
				<span className={`st-mm-status${multiMention?.allFailed ? " is-failed" : ""}`}>
					{received}/{rows.length} 已回复
				</span>
				{message.mentionsUser ? <span className="st-message-badge is-mention">提到了你</span> : null}
				<time className="st-mm-time" dateTime={new Date(message.timestamp).toISOString()}>
					{formatRelative(message.timestamp)}
				</time>
			</div>
			{question ? <p className="st-mm-question">{question}</p> : null}
			<div className="st-mm-rows">
				{rows.map((row) => {
					const label = agentLabel?.(row.targetAgentId) ?? row.targetAgentId;
					return (
						<div className="st-mm-row" key={row.targetAgentId} data-testid={`multi-mention-row-${row.targetAgentId}`}>
							<span className={`st-mm-avatar tone-${toneFor(row.targetAgentId)}`} aria-hidden="true">
								{initialForName(label)}
							</span>
							<div className="st-mm-row-body">
								<div className="st-mm-row-head">
									<span className="st-mm-row-name">{label}</span>
									<span className={`st-mm-row-status is-${row.status}`}>{multiMentionStatusLabel(row.status)}</span>
								</div>
								{row.content ? (
									<div className={expanded ? "st-mm-row-content" : "st-mm-row-content is-clamped"}>
										<MessageContent content={row.content} />
									</div>
								) : row.reason ? (
									<p className="st-mm-row-reason">{row.reason}</p>
								) : null}
								<span className="st-mm-auto">自动汇总 → {callbackLabel}</span>
							</div>
						</div>
					);
				})}
			</div>
			<div className="st-mm-footer">
				<span>汇总已交给 {callbackLabel}</span>
				{hasContent ? (
					<button type="button" className="st-link-button" onClick={() => setExpanded((value) => !value)}>
						{expanded ? "收起" : "查看汇总"}
					</button>
				) : null}
			</div>
		</div>
	);
}

function MessageRow({
	message,
	messagesById,
	onRetryInvocation,
	liveParentIds,
	agentLabel,
	threadLabel,
	onOpenThread,
	live,
	onRichBlockRespond,
}: {
	message: MessageView;
	messagesById: ReadonlyMap<string, MessageView>;
	onRetryInvocation?: (invocationId: string) => Promise<void>;
	liveParentIds: ReadonlySet<string>;
	agentLabel?: (agentId: string) => string;
	threadLabel?: (threadId: string) => string;
	onOpenThread?: (threadId: string) => void;
	live?: LiveExecutionState;
	onRichBlockRespond?: RichBlockRespondHandler;
}) {
	const sender = message.from.kind;
	const processing = isProcessing(message);
	const terminal = terminalStatus(message);
	const invocationId = retryableInvocationId(message);
	const [retrying, setRetrying] = useState(false);
	const [retryState, setRetryState] = useState<"idle" | "queued" | "error">("idle");
	const [retryError, setRetryError] = useState<string | undefined>();
	const crossPost = message.extra?.crossPost;
	const multiMention = message.extra?.multiMention;
	const senderName = senderLabel(message, agentLabel);
	const agentId = message.from.kind === "agent" ? message.from.agentId : null;
	const privateRecipients = privateA2ARecipients(message);
	const liveText = processing && message.content === "" ? live?.text : undefined;
	const retry = async (): Promise<void> => {
		if (!invocationId || retrying || !onRetryInvocation) return;
		setRetrying(true);
		setRetryError(undefined);
		try {
			await onRetryInvocation(invocationId);
			setRetryState("queued");
		} catch (error) {
			setRetryState("error");
			setRetryError(error instanceof Error ? error.message : "重试失败");
		} finally {
			setRetrying(false);
		}
	};
	if (multiMention) {
		return (
			<article className="st-message is-system is-agent-column is-multi-mention" data-message-id={message.id}>
				<div className="st-message-stack">
					<MultiMentionCard message={message} messagesById={messagesById} agentLabel={agentLabel} />
				</div>
			</article>
		);
	}
	if (crossPost) {
		const recipients = crossPostRecipients(message);
		const sourceLabel = threadLabel?.(crossPost.sourceThreadId) ?? crossPost.sourceThreadId;
		return (
			<article
				className="st-message is-agent is-agent-column is-cross-post"
				data-message-id={message.id}
				data-testid="message-cross-post"
			>
				<div className="st-message-stack">
					<div className="st-cross-post-head">
						<span className="st-cross-post-sender">
							<span>{senderName}</span>
							<span className="st-cross-post-source">
								<span>跨线程来自</span>
								{onOpenThread ? (
									<button
										type="button"
										className="st-link-button"
										onClick={() => onOpenThread(crossPost.sourceThreadId)}
									>
										{sourceLabel}
									</button>
								) : (
									<span>{sourceLabel}</span>
								)}
							</span>
						</span>
						{recipients.length > 0 ? (
							<>
								<span className="st-cross-post-arrow" aria-hidden="true">
									→
								</span>
								{recipients.map((targetId) => (
									<span className="st-cross-post-recipient" key={targetId}>
										{agentLabel?.(targetId) ?? targetId}
									</span>
								))}
							</>
						) : null}
						<time dateTime={new Date(message.timestamp).toISOString()}>{formatRelative(message.timestamp)}</time>
					</div>
					<div className="st-cross-post-body">
						<div className="st-cross-post-kind">cross_post_message</div>
						<DispatchTargets message={message} agentLabel={agentLabel} />
						<div className="st-cross-post-divider" role="separator" />
						<MessageContent content={message.content} collapsible />
					</div>
				</div>
			</article>
		);
	}
	if (privateRecipients.length > 0) {
		const recipientLabel = privateRecipients.map((targetId) => agentLabel?.(targetId) ?? targetId).join("、");
		const deliveryState = privateA2ADeliveryState(message, privateRecipients);
		return (
			<article
				className="st-message is-agent is-agent-column is-a2a-private"
				data-message-id={message.id}
				data-testid="message-a2a-private"
			>
				<div className="st-message-stack">
					<div className="st-a2a-private-head">
						<span className="st-a2a-private-sender">{senderName}</span>
						<span className="st-a2a-private-arrow" aria-hidden="true">
							→
						</span>
						<span className="st-a2a-private-recipient">{recipientLabel}</span>
						<span className="st-a2a-private-badge">A2A</span>
						<time dateTime={new Date(message.timestamp).toISOString()}>{formatRelative(message.timestamp)}</time>
					</div>
					<div className="st-a2a-private-body">
						<div className="st-a2a-private-kind">post_message</div>
						<div className="st-a2a-private-divider" role="separator" />
						<MessageContent content={message.content} collapsible />
					</div>
					<div className="st-a2a-private-footer">私人消息 · {deliveryState} {recipientLabel}</div>
				</div>
			</article>
		);
	}
	const meta = (
		<div className="st-message-meta">
			<span className="st-message-sender">{senderName}</span>
			<time dateTime={new Date(message.timestamp).toISOString()}>{formatRelative(message.timestamp)}</time>
		</div>
	);
	const body = (
		<div className="st-message-body">
			{sender === "system" ? meta : null}
				{message.mentionsUser ? (
					<div className="st-message-badges">
						<span className="st-message-badge is-mention">提到了你</span>
					</div>
				) : null}
				<DispatchTargets message={message} agentLabel={agentLabel} />
				{agentId !== null && (message.thinking || (message.toolEvents?.length ?? 0) > 0 || live) ? (
					<MessageExecutionRecord
						thinking={message.thinking}
						toolEvents={message.toolEvents}
						live={processing ? live : undefined}
						state={processing ? "processing" : "terminal"}
					/>
				) : null}
				{message.content !== "" ? (
					<MessageContent content={message.content} collapsible />
				) : liveText ? (
					<MessageContent content={liveText} />
				) : null}
				<RichBlocks extra={message.extra?.rich} messageId={message.id} onRespond={onRichBlockRespond} />
				{processing ? <p className="st-message-processing">正在回复…</p> : null}
				{terminal ? <p className={`st-message-terminal is-${terminal.status}`}>{terminal.label}</p> : null}
				{terminal && invocationId && onRetryInvocation && !liveParentIds.has(invocationId) ? (
					<div className="st-message-actions">
						{retryState === "queued" ? (
							<span className="st-message-retry-state" role="status">
								已重新排队
							</span>
						) : (
							<button type="button" className="st-link-button" onClick={() => void retry()} disabled={retrying}>
								{retrying ? "重试中…" : "重试"}
							</button>
						)}
						{retryState === "error" ? (
							<span className="st-error" role="alert">
								{retryError ?? "重试失败"}
							</span>
						) : null}
					</div>
				) : null}
		</div>
	);
	return (
		<article
			className={`st-message is-${sender}${sender === "agent" ? " is-nameplate" : ""}`}
			data-message-id={message.id}
		>
			{agentId !== null ? (
				<span className={`st-message-avatar tone-${toneFor(agentId)}`} aria-hidden="true">
					{initialForName(senderName)}
				</span>
			) : null}
			<div className={`st-message-stack${sender === "user" ? " is-user" : ""}`}>
				{sender !== "system" ? meta : null}
				{body}
			</div>
			{sender === "user" ? (
				<span className="st-message-avatar is-operator" aria-hidden="true">
					{initialForName("operator")}
				</span>
			) : null}
		</article>
	);
}

export function MessageList({
	thread,
	messages,
	status,
	error,
	hasMore,
	loadingOlder,
	followingLatest,
	pendingUserMessages,
	liveInvocations = [],
	liveExecutions = {},
	agentLabel,
	threadLabel,
	onOpenThread,
	onLoadOlder,
	onRetry,
	onRetryInvocation,
	onResumeLatest,
	onRichBlockRespond,
}: MessageListProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const positionedThread = useRef<string | null>(null);
	const pinnedRef = useRef(true);
	const [pinned, setPinned] = useState(true);
	const scrollKey = `superagentteam:scroll:${thread.id}`;
	pinnedRef.current = pinned;

	useEffect(() => {
		const element = scrollRef.current;
		if (!element || messages.length === 0) return;
		if (positionedThread.current !== thread.id) {
			positionedThread.current = thread.id;
			let saved: number | null = null;
			try {
				const raw = window.sessionStorage.getItem(scrollKey);
				if (raw !== null) saved = Number(raw);
			} catch {
				saved = null;
			}
			if (saved === null || !Number.isFinite(saved) || saved < 0) {
				element.scrollTop = element.scrollHeight;
				pinnedRef.current = true;
				setPinned(true);
				return;
			}
			element.scrollTop = saved;
			const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
			pinnedRef.current = atBottom;
			setPinned(atBottom);
			return;
		}
		if (pinned) element.scrollTop = element.scrollHeight;
	}, [messages.length, pendingUserMessages.length, pinned, scrollKey, thread.id]);

	useEffect(() => {
		const element = scrollRef.current;
		if (!element || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => {
			if (pinnedRef.current) element.scrollTop = element.scrollHeight;
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const onLayoutChanged = (): void => {
			const element = scrollRef.current;
			if (element && pinnedRef.current) element.scrollTop = element.scrollHeight;
		};
		window.addEventListener("superagentteam:chat-layout-changed", onLayoutChanged);
		return () => window.removeEventListener("superagentteam:chat-layout-changed", onLayoutChanged);
	}, []);

	useEffect(() => {
		const element = scrollRef.current;
		if (element && pinnedRef.current) element.scrollTop = element.scrollHeight;
	}, [liveExecutions]);

	const showLatest = !followingLatest || !pinned;
	const liveParentIds = new Set(
		liveInvocations
			.map((invocation) => invocation.parentInvocationId)
			.filter((invocationId): invocationId is string => invocationId !== null),
	);
	const messagesById = new Map(messages.map((message) => [message.id, message]));
	const scrollToLatest = (): void => {
		if (!followingLatest) onResumeLatest();
		pinnedRef.current = true;
		setPinned(true);
		const element = scrollRef.current;
		if (element) element.scrollTop = element.scrollHeight;
	};
	return (
		<div
			className="st-message-scroll"
			ref={scrollRef}
			onScroll={(event) => {
				const element = event.currentTarget;
				const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
				pinnedRef.current = atBottom;
				setPinned(atBottom);
				try {
					window.sessionStorage.setItem(scrollKey, String(element.scrollTop));
				} catch {
					// Storage may be unavailable; live scrolling still works.
				}
			}}
		>
			{error && (messages.length > 0 || pendingUserMessages.length > 0) ? (
				<div className="st-inline-error" role="alert">
					<span>{error}</span>
					<button type="button" className="st-link-button" onClick={onRetry}>
						重试
					</button>
				</div>
			) : null}
			{hasMore ? (
				<div className="st-load-older">
					<button type="button" className="st-button st-button-secondary" onClick={onLoadOlder} disabled={loadingOlder}>
						{loadingOlder ? "正在载入…" : "载入更早的消息"}
					</button>
				</div>
			) : null}
			{status === "loading" && messages.length === 0 ? <p className="st-page-note">正在加载消息…</p> : null}
			{status === "error" && messages.length === 0 ? (
				<div className="st-empty-panel">
					<h1>消息加载失败</h1>
					<p>{error ?? "daemon 暂时没有响应。"}</p>
					<button type="button" className="st-button" onClick={onRetry}>
						重试
					</button>
				</div>
			) : null}
			{status === "ready" && messages.length === 0 && pendingUserMessages.length === 0 ? (
				<div className="st-thread-empty">
					<p>这个对话还没有消息。</p>
					<p className="st-thread-empty-hint">在下面发第一条消息。</p>
				</div>
			) : null}
			{messages.map((message) => (
				<MessageRow
					key={message.id}
					message={message}
					messagesById={messagesById}
					onRetryInvocation={onRetryInvocation}
					liveParentIds={liveParentIds}
					agentLabel={agentLabel}
					threadLabel={threadLabel}
					onOpenThread={onOpenThread}
					onRichBlockRespond={onRichBlockRespond}
					live={
						message.lifecycle?.kind === "response" && message.lifecycle.status === "processing"
							? liveExecutions[message.lifecycle.turnExecutionId]
							: undefined
					}
				/>
			))}
			{pendingUserMessages.map((pending) => (
				<article className="st-message is-user is-pending" key={pending.messageId}>
					<div className="st-message-stack is-user">
						<div className="st-message-meta">
							<span className="st-message-sender">operator</span>
							<span>发送中…</span>
						</div>
						<div className="st-message-body">
							<MessageContent content={pending.content} />
						</div>
					</div>
					<span className="st-message-avatar is-operator" aria-hidden="true">
						{initialForName("operator")}
					</span>
				</article>
			))}
			{liveInvocations
				.filter((invocation) => invocation.responseStatus === "missing")
				.map((invocation) => {
					const live = liveExecutions[invocation.turnExecutionId];
					return (
						<article className="st-message is-agent is-live" key={invocation.turnExecutionId}>
						<span className={`st-message-avatar tone-${toneFor(invocation.agentId)}`} aria-hidden="true">
							{initialForName(agentLabel?.(invocation.agentId) ?? invocation.agentId)}
						</span>
						<div className="st-message-stack">
							<div className="st-message-meta">
								<span className="st-message-sender">{agentLabel?.(invocation.agentId) ?? invocation.agentId}</span>
								<span>已受理</span>
							</div>
							<div className="st-message-body">
								<MessageExecutionRecord live={live} state="processing" />
								{live?.text ? <MessageContent content={live.text} /> : null}
								<p className="st-message-processing">正在处理… · {formatElapsed(invocation.startedAt)}</p>
							</div>
						</div>
						</article>
					);
				})}
			{showLatest ? (
				<div className="st-latest-anchor">
					<button type="button" className="st-button st-button-secondary" onClick={scrollToLatest}>
						回到最新
					</button>
				</div>
			) : null}
		</div>
	);
}
