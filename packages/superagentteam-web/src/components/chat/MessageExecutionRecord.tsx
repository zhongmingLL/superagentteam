import { useEffect, useRef, useState } from "react";

import type { StoredToolEvent } from "@superagentteam/shared/types";
import { Icon } from "@/components/ui/Icon";
import type { LiveExecutionState } from "@/domains/events/execution-store";
import {
	formatToolDuration,
	toolDetail,
	toolDuration,
	toolFailed,
	totalToolDuration,
} from "@/lib/tool-display";
import { MessageContent } from "./MessageContent";

export interface MessageExecutionRecordProps {
	thinking?: string;
	toolEvents?: StoredToolEvent[];
	live?: LiveExecutionState;
	/** processing = live response; terminal = durable history. */
	state: "processing" | "terminal";
}

function thinkingPreview(text: string): string {
	const compact = text.replace(/\s+/g, " ").trim();
	return compact.length > 72 ? `${compact.slice(0, 72)}…` : compact;
}

function ToolStatusIcon({ record }: { record: StoredToolEvent }) {
	if (toolFailed(record)) {
		return (
			<span className="st-tool-status is-failed">
				<Icon name="alert" size={12} />
			</span>
		);
	}
	if (record.status === "running") return <span className="st-tool-spinner" aria-label="运行中" />;
	return (
		<span className="st-tool-status is-done">
			<Icon name="check" size={12} />
		</span>
	);
}

function ToolRow({ record }: { record: StoredToolEvent }) {
	const [open, setOpen] = useState(false);
	const detail = toolDetail(record);
	const label = (
		<>
			<ToolStatusIcon record={record} />
			<span className="st-tool-name" title={record.name}>
				{record.name}
			</span>
			<span className="st-tool-duration">{formatToolDuration(toolDuration(record))}</span>
			{detail !== "" ? (
				<span className={`st-tool-chevron${open ? " is-open" : ""}`}>
					<Icon name="chevron" size={11} />
				</span>
			) : null}
		</>
	);
	return (
		<div className="st-tool-item" data-testid={`execution-tool-${record.toolCallId}`}>
			{detail !== "" ? (
				<button type="button" className="st-tool-row" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
					{label}
				</button>
			) : (
				<div className="st-tool-row">{label}</div>
			)}
			{open && detail !== "" ? <pre className="st-tool-detail">{detail}</pre> : null}
		</div>
	);
}

export function MessageExecutionRecord({ thinking = "", toolEvents = [], live, state }: MessageExecutionRecordProps) {
	const effectiveThinking = live?.thinking || thinking;
	const effectiveTools = live?.toolEvents.length ? live.toolEvents : toolEvents;
	const liveStatus = live?.status;
	const processing = state === "processing";
	const [thinkingOpen, setThinkingOpen] = useState(false);
	const [toolsOpen, setToolsOpen] = useState(() => processing);
	const toolsInteracted = useRef(false);

	useEffect(() => {
		if (toolsInteracted.current) return;
		setToolsOpen(processing && (liveStatus === "running" || liveStatus === "error"));
	}, [liveStatus, processing]);

	useEffect(() => {
		window.dispatchEvent(new Event("superagentteam:chat-layout-changed"));
	}, [thinkingOpen, toolsOpen]);

	if (effectiveThinking === "" && effectiveTools.length === 0 && !live) return null;

	const failed = effectiveTools.some(toolFailed);
	const latest = effectiveTools[effectiveTools.length - 1];
	const toolSummary =
		liveStatus === "error"
			? "执行记录 · 失败"
			: processing && liveStatus !== "done"
				? latest
					? `执行记录 · 正在调用 ${latest.name}`
					: "执行记录 · 准备中"
				: effectiveTools.length > 0
					? `执行记录 · ${effectiveTools.length} 次工具调用 · ${formatToolDuration(totalToolDuration(effectiveTools))}${failed ? " · 有失败" : ""}`
					: null;
	const showTools = toolSummary !== null;

	return (
		<div className="st-execution" data-testid="message-execution-record">
			{effectiveThinking !== "" ? (
				<div className="st-execution-panel">
					<button
						type="button"
						className="st-execution-header"
						aria-expanded={thinkingOpen}
						onClick={() => setThinkingOpen((value) => !value)}
						data-testid="execution-thinking"
					>
						<span className={`st-execution-chevron${thinkingOpen ? " is-open" : ""}`}>
							<Icon name="chevron" size={11} />
						</span>
						<Icon name="brain" size={13} />
						<span className="st-execution-title">Thinking</span>
						{!thinkingOpen ? <span className="st-execution-preview">{thinkingPreview(effectiveThinking)}</span> : null}
					</button>
					{thinkingOpen ? (
						<div className="st-execution-body st-thinking-body">
							<MessageContent content={effectiveThinking} />
						</div>
					) : null}
				</div>
			) : null}
			{showTools ? (
				<div className="st-execution-panel">
					<button
						type="button"
						className="st-execution-header"
						aria-expanded={toolsOpen}
						onClick={() => {
							toolsInteracted.current = true;
							setToolsOpen((value) => !value);
						}}
						data-testid="execution-tools"
					>
						<span className={`st-execution-chevron${toolsOpen ? " is-open" : ""}`}>
							<Icon name="chevron" size={11} />
						</span>
						<Icon name="wrench" size={12} />
						<span className="st-execution-label">{toolSummary}</span>
						{processing && liveStatus === "running" ? <span className="st-tool-spinner" aria-label="运行中" /> : null}
					</button>
					{toolsOpen ? (
						<div className="st-execution-body">
							{effectiveTools.length > 0 ? (
								<div className="st-tool-list">
									{effectiveTools.map((record) => (
										<ToolRow key={record.toolCallId} record={record} />
									))}
								</div>
							) : (
								<p className="st-execution-note">等待工具输出…</p>
							)}
							{live?.error ? <p className="st-execution-error">{live.error}</p> : null}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}
