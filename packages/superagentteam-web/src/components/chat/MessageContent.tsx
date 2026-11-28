import { CollapsibleMarkdown } from "./CollapsibleMarkdown";
import { MarkdownContent } from "./MarkdownContent";

export function MessageContent({ content, collapsible = false }: { content: string; collapsible?: boolean }) {
	return collapsible ? <CollapsibleMarkdown content={content} /> : <MarkdownContent content={content} />;
}
