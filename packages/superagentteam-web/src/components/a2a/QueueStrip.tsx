import { useState } from "react";

import type { LiveInvocationView, QueueEntryView, SteerMode } from "@/domains/a2a/api";
import type { AgentView } from "@/domains/agent/api";
import { agentDisplayName } from "@/domains/agent/labels";
import { formatRelative } from "@/lib/time";
import { SteerQueueDialog } from "./SteerQueueDialog";

export interface QueueStripProps {
	queue: QueueEntryView[];
	agents: AgentView[];
	live?: LiveInvocationView[];
	onSteer?: (queueEntryId: string, targetAgentId: string, mode: SteerMode) => Promise<void>;
	cap?: number;
}

export function QueueStrip({ queue, agents, live = [], onSteer, cap }: QueueStripProps) {
	const [steerEntry, setSteerEntry] = useState<QueueEntryView | null>(null);
	if (queue.length === 0) return null;
	return (
		<section className="st-queue-strip" aria-label="消息队列">
			<div className="st-queue-header">
				<span>队列</span>
				<span
					className="st-queue-count"
					title={cap === undefined ? undefined : `直接消息与 agent 唤醒分别计数，各自最多 ${cap} 条（v1 固定）`}
				>
					{cap === undefined ? queue.length : `${queue.length} / ${cap}`}
				</span>
			</div>
			{cap === undefined ? null : (
				<p className="st-queue-note">每个对话：消息最多 {cap} 条、agent 唤醒最多 {cap} 条（v1 固定）</p>
			)}
			<div className="st-queue-rows">
				{queue.map((entry) => (
					<div className="st-queue-row" key={entry.queueEntryId}>
						<span className="st-queue-position">#{entry.position + 1}</span>
						<span className="st-queue-target" title={entry.targetAgentIds.join(", ")}>
							{entry.targetAgentIds.map((id) => agentDisplayName(agents, id)).join("、") || "自动"}
						</span>
						<span className={`st-queue-state${entry.status === "claimed" ? " is-claimed" : ""}`}>
							{entry.status === "claimed" ? "执行中" : "排队中"}
						</span>
						<time className="st-queue-age" dateTime={new Date(entry.enqueuedAt).toISOString()}>
							{formatRelative(entry.enqueuedAt)}
						</time>
						{onSteer && entry.status === "queued" ? (
							<button
								type="button"
								className="st-queue-steer"
								aria-label="处理这条排队消息"
								onClick={() => setSteerEntry(entry)}
							>
								处理这条
							</button>
						) : null}
					</div>
				))}
			</div>
			{steerEntry && onSteer ? (
				<SteerQueueDialog
					entry={steerEntry}
					agents={agents}
					live={live}
					onCancel={() => setSteerEntry(null)}
					onConfirm={async (actions) => {
						for (const action of actions) {
							await onSteer(steerEntry.queueEntryId, action.targetAgentId, action.mode);
						}
						setSteerEntry(null);
					}}
				/>
			) : null}
		</section>
	);
}
