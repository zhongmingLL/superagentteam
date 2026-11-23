import { useNewThreadDialog } from "@/domains/thread/dialog-store";
import { useThreadStore } from "@/domains/thread/store";
import { useAgentStore } from "@/domains/agent/store";
import { Icon } from "@/components/ui/Icon";

export function HomePage() {
	const threads = useThreadStore((state) => state.threads);
	const agents = useAgentStore((state) => state.agents);
	const showDialog = useNewThreadDialog((state) => state.show);

	return (
		<section className="st-home-page">
			<div className="st-home-hero">
				<span className="st-home-eyebrow">
					<Icon name="sparkles" size={13} />
					SuperAgentTeam · local workspace
				</span>
				<h1>{threads.length === 0 ? "开始一段对话" : "选择一个对话继续"}</h1>
				<p>
					{threads.length === 0
						? "每个对话都有真实的项目路径、消息记录和 agent 状态。"
						: "从左侧选择对话，或者新建一个。消息、A2A 队列和 agent 状态都在同一条时间线上。"}
				</p>
				<button type="button" className="st-button st-home-cta" onClick={() => showDialog()}>
					<Icon name="plus" size={14} />
					<span>新对话</span>
				</button>
				<div className="st-home-stats">
					<div className="st-home-stat">
						<strong>{threads.length}</strong>
						<span>对话</span>
					</div>
					<div className="st-home-stat">
						<strong>{agents.length}</strong>
						<span>Agents</span>
					</div>
					<div className="st-home-stat">
						<strong>{threads.filter((thread) => (thread.unreadCount ?? 0) > 0).length}</strong>
						<span>有未读</span>
					</div>
				</div>
			</div>
		</section>
	);
}
