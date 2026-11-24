import type { LiveInvocationView } from "@/domains/a2a/api";
import type { AgentView } from "@/domains/agent/api";
import { agentDisplayName } from "@/domains/agent/labels";
import { formatElapsed } from "@/lib/time";

export interface LivePillProps {
	live: LiveInvocationView[];
	agents: AgentView[];
	onStop?: (agentId: string) => void;
}

export function LivePill({ live, agents, onStop }: LivePillProps) {
	if (live.length === 0) return null;
	return (
		<span className="st-live-pills">
			{live.map((item) => {
				const name = agentDisplayName(agents, item.agentId);
				const text = `执行中 · ${name} · ${formatElapsed(item.startedAt)}`;
				return (
					<span className="st-live-pill" title={`${text} · thread 内状态`} key={item.turnExecutionId}>
						<span className="st-live-dot" aria-hidden="true" />
						<span className="st-live-text">{text}</span>
						{onStop ? (
							<button
								type="button"
								className="st-live-stop"
								onClick={() => onStop(item.agentId)}
								aria-label={`停止 ${name}`}
							>
								停止
							</button>
						) : null}
					</span>
				);
			})}
		</span>
	);
}
