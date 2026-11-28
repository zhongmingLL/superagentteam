import { useState } from "react";
import { MarkdownContent } from "./MarkdownContent";

export const TEXT_FOLD_THRESHOLD = 20;

export function shouldFoldMarkdown(content: string): boolean {
	if (!content) return false;
	return content.trimEnd().split("\n").length > TEXT_FOLD_THRESHOLD;
}

export function CollapsibleMarkdown({ content }: { content: string }) {
	const fold = shouldFoldMarkdown(content);
	const [expanded, setExpanded] = useState(false);
	if (!fold) return <MarkdownContent content={content} />;
	return (
		<div>
			<div className={`st-markdown-clip${expanded ? "" : " is-collapsed"}`}>
				<MarkdownContent content={content} />
			</div>
			<button
				type="button"
				className="st-link-button st-markdown-toggle"
				aria-expanded={expanded}
				onClick={() => setExpanded((value) => !value)}
			>
				{expanded ? "收起" : "展开"}
			</button>
		</div>
	);
}
