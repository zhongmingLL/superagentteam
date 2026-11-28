import { Children, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

const MENTION_RE =
	/(^|[\s([{（「『【《，。；：、\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])(@[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)/g;

function highlightMentions(children: ReactNode): ReactNode {
	return Children.map(children, (child) => {
		if (typeof child !== "string") return child;
		const nodes: ReactNode[] = [];
		let lastIndex = 0;
		for (const match of child.matchAll(MENTION_RE)) {
			const prefix = match[1] ?? "";
			const mention = match[2] ?? "";
			const start = (match.index ?? 0) + prefix.length;
			if (start > lastIndex) nodes.push(child.slice(lastIndex, start));
			nodes.push(
				<span className="st-mention" key={`mention-${start}`}>
					{mention}
				</span>,
			);
			lastIndex = start + mention.length;
		}
		if (lastIndex === 0) return child;
		if (lastIndex < child.length) nodes.push(child.slice(lastIndex));
		return <>{nodes}</>;
	});
}

const components: Components = {
	p: ({ children }) => <p>{highlightMentions(children)}</p>,
	strong: ({ children }) => <strong>{highlightMentions(children)}</strong>,
	em: ({ children }) => <em>{highlightMentions(children)}</em>,
	del: ({ children }) => <del>{highlightMentions(children)}</del>,
	h1: ({ children }) => <h1>{highlightMentions(children)}</h1>,
	h2: ({ children }) => <h2>{highlightMentions(children)}</h2>,
	h3: ({ children }) => <h3>{highlightMentions(children)}</h3>,
	h4: ({ children }) => <h4>{highlightMentions(children)}</h4>,
	h5: ({ children }) => <h5>{highlightMentions(children)}</h5>,
	h6: ({ children }) => <h6>{highlightMentions(children)}</h6>,
	ul: ({ children }) => <ul>{children}</ul>,
	ol: ({ children }) => <ol>{children}</ol>,
	li: ({ children, className }) => (
		<li className={className === "task-list-item" ? "task-list-item" : undefined}>{highlightMentions(children)}</li>
	),
	input: ({ type, checked }) =>
		type === "checkbox" ? <input type="checkbox" checked={checked} readOnly /> : <input type={type} />,
	blockquote: ({ children }) => <blockquote>{children}</blockquote>,
	a: ({ href, children }) => (
		<a
			href={href}
			target={href?.startsWith("http") ? "_blank" : undefined}
			rel={href?.startsWith("http") ? "noreferrer noopener" : undefined}
		>
			{highlightMentions(children)}
		</a>
	),
	hr: () => <hr />,
	pre: ({ children }) => <pre className="st-code-block">{children}</pre>,
	code: ({ className, children }) => (
		<code className={`st-inline-code${className ? ` ${className}` : ""}`}>{children}</code>
	),
	table: ({ children }) => (
		<div className="st-table-wrap">
			<table>{children}</table>
		</div>
	),
	thead: ({ children }) => <thead>{children}</thead>,
	th: ({ children }) => <th>{highlightMentions(children)}</th>,
	td: ({ children }) => <td>{highlightMentions(children)}</td>,
	img: ({ src, alt }) => <img className="st-markdown-image" src={src} alt={alt ?? ""} loading="lazy" />,
};

export function MarkdownContent({ content }: { content: string }) {
	return (
		<div className="st-message-content">
			<ReactMarkdown
				remarkPlugins={[remarkGfm, remarkBreaks]}
				components={components}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
}
