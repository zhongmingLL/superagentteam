import { useState } from "react";

import type { AgentView } from "@/domains/agent/api";
import { Icon } from "@/components/ui/Icon";
import { SessionChainDialog } from "./SessionChainDialog";

export function SessionChainButton({ threadId, agents }: { threadId?: string; agents: AgentView[] }) {
	const [open, setOpen] = useState(false);
	if (!threadId) return null;
	return (
		<>
			<button
				type="button"
				className="st-icon-button st-agent-button st-session-chain-button"
				aria-expanded={open}
				aria-haspopup="dialog"
				aria-label="Sessions"
				onClick={() => setOpen(true)}
			>
				<Icon name="threads" size={14} />
				<span>Sessions</span>
			</button>
			{open ? <SessionChainDialog threadId={threadId} agents={agents} onClose={() => setOpen(false)} /> : null}
		</>
	);
}
