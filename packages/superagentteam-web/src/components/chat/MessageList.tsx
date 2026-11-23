import { useEffect, useRef, useState } from "react";

import type { LiveInvocationView } from "@/domains/a2a/api";
import type { MessageView } from "@/domains/chat/api";
import type { LiveExecutionMap, LiveExecutionState } from "@/domains/events/execution-store";
import type { ThreadView } from "@/domains/thread/api";
import { initialForName, toneFor } from "@/lib/identity";
import { formatElapsed, formatRelative } from "@/lib/time";
import { Icon } from "@/components/ui/Icon";
import { MessageExecutionRecord } from "./MessageExecutionRecord";
import { MessageContent } from "./MessageContent";

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
}

function senderLabel(message: MessageView, agentLabel?: (agentId: string) => string): string {
	if (message.from.kind === "user") return "你";
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

function MessageRow({
	message,
	onRetryInvocation,
	liveParentIds,
	agentLabel,
	threadLabel,
	onOpenThread,
	live,
}: {
	message: MessageView;
	onRetryInvocation?: (invocationId: string) => Promise<void>;
	liveParentIds: ReadonlySet<string>;
	agentLabel?: (agentId: string) => string;
	threadLabel?: (threadId: string) => string;
	onOpenThread?: (threadId: string) => void;
	live?: LiveExecutionState;
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
	return (
		<article className={`st-message is-${sender}`} data-message-id={message.id}>
			{agentId !== null ? (
				<span className={`st-message-avatar tone-${toneFor(agentId)}`} aria-hidden="true">
					{initialForName(senderName)}
				</span>
			) : null}
			<div className="st-message-body">
				<div className="st-message-meta">
					<span className="st-message-sender">{senderName}</span>
					<time dateTime={new Date(message.timestamp).toISOString()}>{formatRelative(message.timestamp)}</time>
				</div>
				{crossPost || multiMention || message.mentionsUser ? (
					<div className="st-message-badges">
						{crossPost ? (
							<span className="st-message-badge is-cross">
								<Icon name="cross" size={11} />
								跨线程来自{" "}
								{onOpenThread ? (
									<button
										type="button"
										className="st-link-button"
										onClick={() => onOpenThread(crossPost.sourceThreadId)}
									>
										{threadLabel?.(crossPost.sourceThreadId) ?? crossPost.sourceThreadId}
									</button>
								) : (
									<code>{threadLabel?.(crossPost.sourceThreadId) ?? crossPost.sourceThreadId}</code>
								)}
							</span>
						) : null}
						{multiMention ? (
							<span className="st-message-badge is-multi">
								<Icon name="agents" size={11} />
								multi-mention · {multiMention.status ?? "done"} · {multiMention.targetAgentIds?.length ?? 0} targets
							</span>
						) : null}
						{message.mentionsUser ? <span className="st-message-badge is-mention">提到了你</span> : null}
					</div>
				) : null}
				{agentId !== null && (message.thinking || (message.toolEvents?.length ?? 0) > 0 || live) ? (
					<MessageExecutionRecord
						thinking={message.thinking}
						toolEvents={message.toolEvents}
						live={processing ? live : undefined}
						state={processing ? "processing" : "terminal"}
					/>
				) : null}
				{message.content !== "" ? (
					<MessageContent content={message.content} />
				) : liveText ? (
					<MessageContent content={liveText} />
				) : null}
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
	const scrollToLatest = (): void => {
		if (!followingLatest) onResumeLatest();
		pinnedRef.current = true;
		setPinned(true);
		const element = scrollRef.current;
		if (element) element.scrollTop = element.scrollHeight;
	};
	const dayLabel =
		messages.length > 0
			? new Date(messages[0]!.timestamp).toLocaleDateString("zh-CN", { month: "long", day: "numeric" })
			: "今天";

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
			{messages.length > 0 ? (
				<div className="st-day-separator">
					<span>{dayLabel}</span>
				</div>
			) : null}
			{messages.map((message) => (
				<MessageRow
					key={message.id}
					message={message}
					onRetryInvocation={onRetryInvocation}
					liveParentIds={liveParentIds}
					agentLabel={agentLabel}
					threadLabel={threadLabel}
					onOpenThread={onOpenThread}
					live={
						message.lifecycle?.kind === "response" && message.lifecycle.status === "processing"
							? liveExecutions[message.lifecycle.turnExecutionId]
							: undefined
					}
				/>
			))}
			{pendingUserMessages.map((pending) => (
				<article className="st-message is-user is-pending" key={pending.messageId}>
					<div className="st-message-body">
						<div className="st-message-meta">
							<span className="st-message-sender">你</span>
							<span>发送中…</span>
						</div>
						<MessageContent content={pending.content} />
					</div>
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
						<div className="st-message-body">
							<div className="st-message-meta">
								<span className="st-message-sender">{agentLabel?.(invocation.agentId) ?? invocation.agentId}</span>
								<span>已受理</span>
							</div>
							<MessageExecutionRecord live={live} state="processing" />
							{live?.text ? <MessageContent content={live.text} /> : null}
							<p className="st-message-processing">正在处理… · {formatElapsed(invocation.startedAt)}</p>
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
