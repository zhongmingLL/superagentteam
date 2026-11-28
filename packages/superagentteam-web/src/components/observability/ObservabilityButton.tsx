import { useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { ObservabilityDialog } from "./ObservabilityDialog";

export function ObservabilityButton({ threadId }: { threadId?: string }) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button
				type="button"
				className="st-icon-button st-agent-button st-observability-button"
				aria-expanded={open}
				aria-haspopup="dialog"
				aria-label="Observability"
				onClick={() => setOpen(true)}
			>
				<Icon name="activity" size={14} />
				<span>Observability</span>
			</button>
			{open ? <ObservabilityDialog threadId={threadId} onClose={() => setOpen(false)} /> : null}
		</>
	);
}
