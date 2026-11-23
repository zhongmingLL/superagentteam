import { NavLink } from "react-router-dom";

import { useA2AStore } from "@/domains/a2a/store";
import type { ThreadView } from "@/domains/thread/api";
import { initialForThread, toneFor } from "@/lib/identity";
import { formatRelative } from "@/lib/time";

export function ThreadRow({ thread }: { thread: ThreadView }) {
	const live = useA2AStore((state) => state.threadId === thread.id && state.live.length > 0);
	const title = thread.title ?? "未命名对话";
	return (
		<NavLink
			to={`/thread/${encodeURIComponent(thread.id)}`}
			className={({ isActive }) => `st-thread-row${isActive ? " is-active" : ""}`}
		>
			<span className="st-thread-accent" aria-hidden="true" />
			<span className={`st-thread-avatar tone-${toneFor(thread.id)}`} aria-hidden="true">
				{initialForThread(thread.title)}
			</span>
			<span className="st-thread-body">
				<span className="st-thread-title">{title}</span>
				<span className="st-thread-project" title={thread.projectPath}>
					{thread.projectPath}
				</span>
			</span>
			<span className="st-thread-meta">
				<span>{formatRelative(thread.lastActiveAt)}</span>
				<span className="st-thread-status">
					{thread.unreadCount && thread.unreadCount > 0 ? (
						<span className="st-thread-unread" role="status" aria-label={`${thread.unreadCount} 条未读`}>
							{thread.unreadCount > 99 ? "99+" : thread.unreadCount}
						</span>
					) : null}
					{live ? (
						<span className="st-thread-live" title="执行中">
							<span className="st-thread-live-dot" aria-hidden="true" />
							<span className="st-visually-hidden">执行中</span>
						</span>
					) : null}
				</span>
			</span>
		</NavLink>
	);
}
