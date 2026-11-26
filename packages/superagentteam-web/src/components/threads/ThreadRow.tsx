import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

import { useA2AStore } from "@/domains/a2a/store";
import type { ThreadView } from "@/domains/thread/api";
import { useThreadStore } from "@/domains/thread/store";
import { initialForThread, toneFor } from "@/lib/identity";
import { formatRelative } from "@/lib/time";
import { Icon } from "@/components/ui/Icon";

export function ThreadRow({ thread }: { thread: ThreadView }) {
	const live = useA2AStore((state) => state.threadId === thread.id && state.live.length > 0);
	const rename = useThreadStore((state) => state.rename);
	const location = useLocation();
	const title = thread.title ?? "未命名对话";
	const href = `/thread/${encodeURIComponent(thread.id)}`;
	const active = location.pathname === href;
	const [menuOpen, setMenuOpen] = useState(false);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(title);
	const [saving, setSaving] = useState(false);
	const [renameError, setRenameError] = useState<string | undefined>();
	const actionsRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (editing) inputRef.current?.focus();
	}, [editing]);

	useEffect(() => {
		if (!menuOpen) return;
		const onPointerDown = (event: MouseEvent): void => {
			if (event.target instanceof Node && actionsRef.current?.contains(event.target)) return;
			setMenuOpen(false);
		};
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === "Escape") setMenuOpen(false);
		};
		document.addEventListener("mousedown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("mousedown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [menuOpen]);

	const startRename = (): void => {
		setMenuOpen(false);
		setDraft(thread.title ?? "");
		setRenameError(undefined);
		setEditing(true);
	};

	const cancelRename = (): void => {
		setEditing(false);
		setDraft(thread.title ?? "");
		setRenameError(undefined);
	};

	const submitRename = async (): Promise<void> => {
		const next = draft.trim();
		if (saving) return;
		if (!next) {
			setRenameError("对话名不能为空");
			return;
		}
		if (next === (thread.title ?? "")) {
			cancelRename();
			return;
		}
		setSaving(true);
		setRenameError(undefined);
		try {
			await rename(thread.id, next);
			setEditing(false);
		} catch (error) {
			setRenameError(error instanceof Error ? error.message : "重命名失败");
		} finally {
			setSaving(false);
		}
	};

	const rowContent = (
		<>
			<span className="st-thread-accent" aria-hidden="true" />
			<span className={`st-thread-avatar tone-${toneFor(thread.id)}`} aria-hidden="true">
				{initialForThread(thread.title)}
			</span>
			<span className="st-thread-body">
				{editing ? (
					<input
						ref={inputRef}
						className="st-thread-rename"
						aria-label="对话名"
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								void submitRename();
							}
							if (event.key === "Escape") {
								event.preventDefault();
								cancelRename();
							}
						}}
						disabled={saving}
						maxLength={200}
					/>
				) : (
					<span className="st-thread-title">{title}</span>
				)}
				<span className="st-thread-project" title={thread.projectPath}>
					{thread.projectPath}
				</span>
				{editing && renameError ? (
					<span className="st-thread-rename-error" role="alert">
						{renameError}
					</span>
				) : null}
			</span>
			{editing ? null : (
				<span className="st-thread-meta">
					{live ? null : <span>{formatRelative(thread.lastActiveAt)}</span>}
					<span className="st-thread-status">
						{thread.unreadCount && thread.unreadCount > 0 ? (
							<span className="st-thread-unread" role="status" aria-label={`${thread.unreadCount} 条未读`}>
								{thread.unreadCount > 99 ? "99+" : thread.unreadCount}
							</span>
						) : null}
						{live ? (
							<span className="st-thread-live" title="执行中">
								<span className="st-thread-live-dot" aria-hidden="true" />
								<span>执行中</span>
							</span>
						) : null}
					</span>
				</span>
			)}
		</>
	);

	return (
		<div className="st-thread-row-wrap">
			{editing ? (
				<div className={`st-thread-row${active ? " is-active" : ""}`}>{rowContent}</div>
			) : (
				<NavLink
					to={href}
					className={({ isActive }) => `st-thread-row${isActive ? " is-active" : ""}`}
				>
					{rowContent}
				</NavLink>
			)}
			{editing ? null : (
				<div className="st-thread-actions" ref={actionsRef}>
					<button
						type="button"
						className="st-thread-more"
						aria-label="更多操作"
						aria-haspopup="menu"
						aria-expanded={menuOpen}
						title="更多操作"
						onClick={() => setMenuOpen((open) => !open)}
					>
						<Icon name="more-vertical" size={14} />
					</button>
					{menuOpen ? (
						<div className="st-thread-menu" role="menu" aria-label="对话操作">
							<button type="button" role="menuitem" className="st-thread-menu-item" onClick={startRename}>
								<Icon name="edit" size={13} />
								<span>重命名对话</span>
							</button>
						</div>
					) : null}
				</div>
			)}
		</div>
	);
}
