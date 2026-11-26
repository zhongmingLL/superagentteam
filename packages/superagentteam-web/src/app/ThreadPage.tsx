import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { Composer } from "@/components/chat/Composer";
import { MessageList } from "@/components/chat/MessageList";
import { LivePill } from "@/components/a2a/LivePill";
import { QueueStrip } from "@/components/a2a/QueueStrip";
import { useA2AStore } from "@/domains/a2a/store";
import { useAgentStore } from "@/domains/agent/store";
import { useChatStore } from "@/domains/chat/store";
import type { ChangeTopic } from "@/domains/events/client";
import { useExecutionStore } from "@/domains/events/execution-store";
import { useEventStore } from "@/domains/events/store";
import { useThreadEvents } from "@/domains/events/use-thread-events";
import { useThreadStore } from "@/domains/thread/store";
import { initialForName, toneFor } from "@/lib/identity";
import { usePolling } from "@/lib/polling";

export function ThreadPage() {
	const { threadId } = useParams<{ threadId: string }>();
	const navigate = useNavigate();
	const detail = useThreadStore((state) => state.detail);
	const threadList = useThreadStore((state) => state.threads);
	const listThread = useThreadStore((state) => state.threads.find((item) => item.id === threadId));
	const listStatus = useThreadStore((state) => state.status);
	const detailStatus = useThreadStore((state) => state.detailStatus);
	const detailError = useThreadStore((state) => state.detailError);
	const loadDetail = useThreadStore((state) => state.loadDetail);

	const messages = useChatStore((state) => state.messages);
	const chatThreadId = useChatStore((state) => state.threadId);
	const chatStatus = useChatStore((state) => state.status);
	const chatError = useChatStore((state) => state.error);
	const hasMore = useChatStore((state) => state.hasMore);
	const loadingOlder = useChatStore((state) => state.loadingOlder);
	const followingLatest = useChatStore((state) => state.followingLatest);
	const pendingUserMessages = useChatStore((state) => state.pendingUserMessages);
	const loadLatest = useChatStore((state) => state.loadLatest);
	const loadOlder = useChatStore((state) => state.loadOlder);
	const resumeLatest = useChatStore((state) => state.resumeLatest);
	const refresh = useChatStore((state) => state.refresh);
	const send = useChatStore((state) => state.send);
	const reset = useChatStore((state) => state.reset);
	const a2aThreadId = useA2AStore((state) => state.threadId);
	const a2aQueue = useA2AStore((state) => state.queue);
	const a2aLive = useA2AStore((state) => state.live);
	const a2aCap = useA2AStore((state) => state.cap);
	const a2aStatus = useA2AStore((state) => state.status);
	const a2aError = useA2AStore((state) => state.error);
	const loadA2A = useA2AStore((state) => state.load);
	const refreshA2A = useA2AStore((state) => state.refresh);
	const retryInvocation = useA2AStore((state) => state.retryInvocation);
	const cancelAgent = useA2AStore((state) => state.cancelAgent);
	const resetA2A = useA2AStore((state) => state.reset);
	const agents = useAgentStore((state) => state.agents);
	const liveExecutions = useExecutionStore((state) => state.turns);
	const resolvedThread = detail?.id === threadId ? detail : listThread;
	const markRead = useThreadStore((state) => state.markRead);
	const refreshThreads = useThreadStore((state) => state.refresh);
	const chatMatches = chatThreadId === threadId;
	const deleted = resolvedThread?.deletedAt !== null && resolvedThread?.deletedAt !== undefined;
	const latestMessageId = chatMatches && messages.length > 0 ? messages[messages.length - 1]?.id : undefined;
	const [visible, setVisible] = useState(
		() => typeof document === "undefined" || document.visibilityState !== "hidden",
	);
	const openedThreadRef = useRef<string | null>(null);
	const lastMarkedRef = useRef<{ threadId: string; messageId: string } | null>(null);
	const [stopError, setStopError] = useState<string | undefined>();

	const handleEventRefresh = useCallback(
		(topics: readonly ChangeTopic[]) => {
			if (topics.includes("messages")) void refresh();
			if (topics.includes("queue") || topics.includes("live")) void refreshA2A();
			if (topics.includes("thread") && threadId) {
				void loadDetail(threadId);
				void refreshThreads();
			}
		},
		[refresh, refreshA2A, loadDetail, refreshThreads, threadId],
	);
	useLayoutEffect(() => {
		if (!threadId) return;
		useExecutionStore.getState().begin(threadId);
		return () => {
			useExecutionStore.getState().reset();
		};
	}, [threadId]);
	useThreadEvents({
		threadId: resolvedThread?.id,
		onRefresh: handleEventRefresh,
		onStream: (event) => useExecutionStore.getState().apply(event.threadId, event.event),
	});
	const realtimeStatus = useEventStore((state) => (state.threadId === threadId ? state.status : "idle"));
	const realtimeLive = realtimeStatus === "live";

	useEffect(() => {
		if (!threadId) return;
		void loadDetail(threadId);
		void loadLatest(threadId);
		void loadA2A(threadId);
		return () => {
			reset();
			resetA2A();
		};
	}, [threadId, loadDetail, loadLatest, loadA2A, reset, resetA2A]);

	useEffect(() => {
		const onChange = (): void => setVisible(document.visibilityState !== "hidden");
		document.addEventListener("visibilitychange", onChange);
		return () => document.removeEventListener("visibilitychange", onChange);
	}, []);

	useEffect(() => {
		if (!threadId || !chatMatches || chatStatus !== "ready" || deleted) return;
		if (openedThreadRef.current === threadId) return;
		openedThreadRef.current = threadId;
		if (!latestMessageId) return;
		lastMarkedRef.current = { threadId, messageId: latestMessageId };
		void markRead(threadId, latestMessageId).then((ok) => {
			if (!ok) lastMarkedRef.current = null;
		});
	}, [threadId, chatMatches, chatStatus, deleted, latestMessageId, markRead]);

	useEffect(() => {
		if (!threadId || !chatMatches || chatStatus !== "ready" || deleted || !latestMessageId) return;
		if (openedThreadRef.current !== threadId) return;
		const last = lastMarkedRef.current;
		if (last?.threadId === threadId && last.messageId === latestMessageId) return;
		if (!followingLatest || !visible) return;
		lastMarkedRef.current = { threadId, messageId: latestMessageId };
		void markRead(threadId, latestMessageId).then((ok) => {
			if (!ok) lastMarkedRef.current = null;
		});
	}, [threadId, chatMatches, chatStatus, deleted, latestMessageId, followingLatest, visible, markRead]);

	const poll = useCallback(async () => {
		if (!threadId || detailStatus === "not_found") return true;
		if (useChatStore.getState().threadId !== threadId) return true;
		return refresh();
	}, [threadId, detailStatus, refresh]);
	usePolling(poll, { intervalMs: realtimeLive ? 30_000 : 2_000, runImmediately: false });
	const pollA2A = useCallback(async () => {
		if (!threadId || detailStatus === "not_found") return true;
		if (detail?.deletedAt !== null && detail?.deletedAt !== undefined) return true;
		if (useA2AStore.getState().threadId !== threadId) return true;
		return refreshA2A();
	}, [threadId, detailStatus, detail?.deletedAt, refreshA2A]);
	usePolling(pollA2A, { intervalMs: realtimeLive ? 30_000 : 2_000, runImmediately: false });

	if (!threadId) {
		return (
			<section className="st-empty-panel">
				<h1>对话不存在</h1>
				<Link className="st-button st-button-secondary" to="/">
					返回
				</Link>
			</section>
		);
	}

	const thread = resolvedThread;
	if (!thread && detailStatus === "not_found") {
		return (
			<section className="st-empty-panel">
				<h1>对话不存在</h1>
				<p>它可能已被删除，或者不在当前 operator 名下。</p>
				<Link className="st-button st-button-secondary" to="/">
					返回
				</Link>
			</section>
		);
	}
	if (!thread && detailStatus === "error") {
		return (
			<section className="st-empty-panel">
				<h1>对话加载失败</h1>
				<p>{detailError ?? "daemon 暂时没有响应。"}</p>
				<button type="button" className="st-button" onClick={() => void loadDetail(threadId)}>
					重试
				</button>
				<Link className="st-button st-button-secondary" to="/">
					返回
				</Link>
			</section>
		);
	}
	if (!thread) {
		return <p className="st-page-note">{detailStatus === "loading" || listStatus === "loading" ? "正在加载对话…" : "对话不存在"}</p>;
	}

	const a2aMatches = a2aThreadId === threadId;
	const memberViews = thread.participants.map((id) => ({
		id,
		name: agents.find((agent) => agent.id === id)?.displayName ?? id,
	}));
	return (
		<>
			<section className="st-thread-page-head" aria-busy={!chatMatches || chatStatus === "loading"}>
				<header className="st-thread-header">
				<div className="st-thread-meta-row">
					<div className="st-thread-header-meta">
						<code title={thread.projectPath}>{thread.projectPath}</code>
					</div>
					{memberViews.length > 0 ? (
						<div className="st-thread-members" aria-label={`${memberViews.length} 位成员`}>
							{memberViews.slice(0, 4).map((member) => (
								<span
									key={member.id}
									className={`st-member-avatar tone-${toneFor(member.id)}`}
									title={member.name}
								>
									{initialForName(member.name)}
								</span>
							))}
							<span className="st-thread-members-count">{memberViews.length} 位成员</span>
						</div>
					) : null}
				</div>
				</header>
			</section>
			<div className="st-thread-divider" data-testid="thread-header-divider" aria-hidden="true" />
			<section className="st-thread-page-body" aria-busy={!chatMatches || chatStatus === "loading"}>
			{deleted ? <p className="st-thread-deleted">这个对话已删除，历史只读。</p> : null}
			{realtimeStatus === "fallback" ? (
				<p className="st-realtime-note" role="status">
					实时更新不可用，正在使用轮询。
				</p>
			) : null}
			<MessageList
				thread={thread}
				messages={chatMatches ? messages : []}
				status={chatMatches ? chatStatus : "loading"}
				error={chatMatches ? chatError : undefined}
				hasMore={chatMatches ? hasMore : false}
				loadingOlder={chatMatches ? loadingOlder : false}
				followingLatest={chatMatches ? followingLatest : true}
				pendingUserMessages={chatMatches ? pendingUserMessages : []}
				onLoadOlder={() => void loadOlder()}
				onRetry={() => void refresh()}
				onRetryInvocation={(invocationId) => retryInvocation(invocationId)}
				onResumeLatest={() => void resumeLatest()}
				liveInvocations={a2aMatches ? a2aLive : []}
				liveExecutions={liveExecutions}
				agentLabel={(agentId) => agents.find((agent) => agent.id === agentId)?.displayName ?? agentId}
				threadLabel={(sourceThreadId) =>
					threadList.find((item) => item.id === sourceThreadId)?.title ?? sourceThreadId
				}
				onOpenThread={(sourceThreadId) => navigate(`/thread/${encodeURIComponent(sourceThreadId)}`)}
			/>
			{a2aMatches && (a2aStatus === "error" || a2aError !== undefined) ? (
				<p className="st-a2a-degraded" role="status">
					队列状态暂时不可用{a2aError ? `：${a2aError}` : "。"}
					<button type="button" className="st-link-button" onClick={() => void refreshA2A()}>
						重试
					</button>
				</p>
			) : null}
			<QueueStrip queue={a2aMatches ? a2aQueue : []} agents={agents} cap={a2aCap} />
			{a2aMatches && a2aLive.length > 0 ? (
				<div className="st-thread-status-row">
					<LivePill
						live={a2aLive}
						agents={agents}
						onStop={(agentId) => {
							setStopError(undefined);
							void cancelAgent(agentId).catch((error: unknown) => {
								setStopError(error instanceof Error ? error.message : "停止失败");
							});
						}}
					/>
				</div>
			) : null}
			{stopError ? (
				<p className="st-a2a-degraded" role="alert">
					{stopError}
				</p>
			) : null}
			<div className="st-composer-wrap">
				<Composer
					key={threadId}
					threadId={threadId}
					agents={agents}
					onSend={async (content, idempotencyKey, targetAgentIds) => {
						if (targetAgentIds) await send(content, idempotencyKey, targetAgentIds);
						else await send(content, idempotencyKey);
						await refreshA2A();
					}}
					disabled={deleted}
					disabledReason="这个对话已删除，不能再发送消息。"
				/>
			</div>
			</section>
		</>
	);
}
