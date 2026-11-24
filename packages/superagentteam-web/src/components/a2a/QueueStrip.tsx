import type { QueueEntryView } from "@/domains/a2a/api";
import type { AgentView } from "@/domains/agent/api";
import { agentDisplayName } from "@/domains/agent/labels";
import { formatRelative } from "@/lib/time";

export interface QueueStripProps {
	queue: QueueEntryView[];
	agents: AgentView[];
	cap?: number;
}

export function QueueStrip({ queue, agents, cap }: QueueStripProps) {
	if (queue.length === 0) return null;
	return (
		<section className="st-queue-strip" aria-label="消息队列">
			<div className="st-queue-header">
				<span>队列</span>
				<span className="st-queue-count" title={cap === undefined ? undefined : `每个 thread 每种 kind 最多 ${cap} 条（v1 固定）`}>
					{cap === undefined ? queue.length : `${queue.length} / ${cap}`}
				</span>
			</div>
			{cap === undefined ? null : <p className="st-queue-note">每个对话同类最多 {cap} 条（v1 固定）</p>}
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
					</div>
				))}
			</div>
		</section>
	);
}
