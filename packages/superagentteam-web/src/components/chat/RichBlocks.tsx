import type { RichMessageExtra } from "@superagentteam/shared/types";

import { MessageContent } from "./MessageContent";

type RichBlock = RichMessageExtra["blocks"][number];

const MAX_BLOCKS = 20;
const MAX_MEDIA_ITEMS = 8;
const MIN_WIDGET_HEIGHT = 50;
const MAX_WIDGET_HEIGHT = 800;

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function list(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function safeHttpUrl(value: unknown): string | undefined {
	const raw = text(value)?.trim();
	if (!raw) return undefined;
	try {
		const parsed = new URL(raw, window.location.origin);
		return parsed.protocol === "http:" || parsed.protocol === "https:" ? raw : undefined;
	} catch {
		return undefined;
	}
}

function safeImageUrl(value: unknown): string | undefined {
	const raw = text(value)?.trim();
	if (raw?.startsWith("data:image/")) return raw;
	return safeHttpUrl(value);
}

function safeAudioUrl(value: unknown): string | undefined {
	const raw = text(value)?.trim();
	if (raw?.startsWith("data:audio/")) return raw;
	return safeHttpUrl(value);
}

function clampWidgetHeight(value: unknown): number {
	const parsed = typeof value === "number" && Number.isFinite(value) ? value : 300;
	return Math.min(MAX_WIDGET_HEIGHT, Math.max(MIN_WIDGET_HEIGHT, Math.round(parsed)));
}

function BlockCard({ block }: { block: Record<string, unknown> }) {
	const title = text(block.title) ?? "卡片";
	const body = text(block.bodyMarkdown);
	const tone = text(block.tone);
	const fields = list(block.fields)
		.map((field) => record(field))
		.filter((field): field is Record<string, unknown> => field !== undefined)
		.slice(0, 12);
	const actions = list(block.actions)
		.map((action) => record(action))
		.filter((action): action is Record<string, unknown> => action !== undefined)
		.slice(0, 6);
	return (
		<section className={`st-rich-card${tone ? ` is-${tone}` : ""}`}>
			<h4 className="st-rich-card-title">{title}</h4>
			{body ? <MessageContent content={body} /> : null}
			{fields.length > 0 ? (
				<dl className="st-rich-fields">
					{fields.map((field, index) => (
						<div className="st-rich-field" key={`${text(field.label) ?? "field"}-${index}`}>
							<dt>{text(field.label) ?? ""}</dt>
							<dd>{text(field.value) ?? ""}</dd>
						</div>
					))}
				</dl>
			) : null}
			{actions.length > 0 ? (
				<div className="st-rich-actions" aria-label="卡片动作（只读）">
					{actions.map((action, index) => (
						<span className="st-rich-action" key={`${text(action.action) ?? "action"}-${index}`}>
							{text(action.label) ?? "动作"}
						</span>
					))}
				</div>
			) : null}
		</section>
	);
}

function BlockDiff({ block }: { block: Record<string, unknown> }) {
	const filePath = text(block.filePath);
	const diff = text(block.diff);
	if (!diff) return <RichFallback kind="diff" reason="缺少 diff 内容" />;
	return (
		<section className="st-rich-diff">
			{filePath ? <div className="st-rich-diff-path">{filePath}</div> : null}
			<pre>
				<code>{diff}</code>
			</pre>
		</section>
	);
}

function BlockChecklist({ block }: { block: Record<string, unknown> }) {
	const title = text(block.title);
	const items = list(block.items)
		.map((item) => record(item))
		.filter((item): item is Record<string, unknown> => item !== undefined)
		.slice(0, 30);
	if (items.length === 0) return <RichFallback kind="checklist" reason="清单为空" />;
	return (
		<section className="st-rich-checklist">
			{title ? <h4 className="st-rich-card-title">{title}</h4> : null}
			<ul>
				{items.map((item, index) => (
					<li key={text(item.id) ?? `item-${index}`} className={item.checked === true ? "is-checked" : ""}>
						<span className="st-rich-check" aria-hidden="true">
							{item.checked === true ? "✓" : "○"}
						</span>
						<span>{text(item.text) ?? ""}</span>
					</li>
				))}
			</ul>
		</section>
	);
}

function BlockMediaGallery({ block }: { block: Record<string, unknown> }) {
	const title = text(block.title);
	const items = list(block.items)
		.map((item) => record(item))
		.filter((item): item is Record<string, unknown> => item !== undefined)
		.slice(0, MAX_MEDIA_ITEMS);
	const media = items
		.map((item) => ({ url: safeImageUrl(item.url), alt: text(item.alt), caption: text(item.caption) }))
		.filter((item): item is { url: string; alt: string | undefined; caption: string | undefined } => item.url !== undefined);
	if (media.length === 0) return <RichFallback kind="media_gallery" reason="没有可展示的图片" />;
	return (
		<section className="st-rich-gallery">
			{title ? <h4 className="st-rich-card-title">{title}</h4> : null}
			<div className="st-rich-gallery-grid">
				{media.map((item, index) => (
					<figure className="st-rich-gallery-item" key={`${item.url}-${index}`}>
						<img src={item.url} alt={item.alt ?? item.caption ?? ""} loading="lazy" />
						{item.caption ? <figcaption>{item.caption}</figcaption> : null}
					</figure>
				))}
			</div>
			{items.length < list(block.items).length ? (
				<p className="st-rich-note">还有 {list(block.items).length - items.length} 张未展示</p>
			) : null}
		</section>
	);
}

function BlockFile({ block }: { block: Record<string, unknown> }) {
	const fileName = text(block.fileName) ?? "文件";
	const url = safeHttpUrl(block.url);
	const mimeType = text(block.mimeType);
	const fileSize = text(block.fileSize);
	const meta = [mimeType, fileSize].filter((item): item is string => item !== undefined).join(" · ");
	return (
		<section className="st-rich-file">
			{url ? (
				<a href={url} target="_blank" rel="noreferrer">
					{fileName}
				</a>
			) : (
				<span>{fileName}</span>
			)}
			{meta ? <span className="st-rich-file-meta">{meta}</span> : null}
		</section>
	);
}

function BlockAudio({ block }: { block: Record<string, unknown> }) {
	const url = safeAudioUrl(block.url);
	const title = text(block.title);
	const spoken = text(block.text);
	if (!url) {
		return spoken ? <p className="st-rich-audio-text">🔊 {spoken}</p> : <RichFallback kind="audio" reason="缺少音频地址" />;
	}
	return (
		<section className="st-rich-audio">
			{title ? <h4 className="st-rich-card-title">{title}</h4> : null}
			<audio controls preload="none" src={url} />
			{spoken ? <p className="st-rich-audio-text">{spoken}</p> : null}
		</section>
	);
}

function BlockHtmlWidget({ block }: { block: Record<string, unknown> }) {
	const html = text(block.html);
	if (!html) return <RichFallback kind="html_widget" reason="缺少 HTML 内容" />;
	const title = text(block.title) ?? "HTML 小组件";
	return (
		<section className="st-rich-widget">
			<div className="st-rich-widget-title">{title}</div>
			<iframe
				title={title}
				sandbox="allow-scripts"
				srcDoc={html}
				height={clampWidgetHeight(block.height)}
			/>
		</section>
	);
}

function BlockInteractive({ block }: { block: Record<string, unknown> }) {
	const title = text(block.title) ?? "交互选项";
	const description = text(block.description);
	const options = list(block.options)
		.map((option) => record(option))
		.filter((option): option is Record<string, unknown> => option !== undefined)
		.slice(0, 12);
	if (options.length === 0) return <RichFallback kind="interactive" reason="没有可展示的选项" />;
	return (
		<section className="st-rich-interactive">
			<h4 className="st-rich-card-title">{title}</h4>
			{description ? <p className="st-rich-interactive-description">{description}</p> : null}
			<div className="st-rich-options">
				{options.map((option, index) => (
					<span className="st-rich-option" key={text(option.id) ?? `option-${index}`}>
						<span>{text(option.label) ?? "选项"}</span>
						{text(option.description) ? <small>{text(option.description)}</small> : null}
					</span>
				))}
			</div>
			<p className="st-rich-note">交互动作将在后续阶段接入</p>
		</section>
	);
}

function RichFallback({ kind, reason }: { kind: string; reason: string }) {
	return (
		<section className="st-rich-fallback">
			<strong>无法展示 {kind} 富块</strong>
			<span>{reason}</span>
		</section>
	);
}

function RichBlockView({ block }: { block: RichBlock }) {
	const data = block as Record<string, unknown>;
	switch (block.kind) {
		case "card":
			return <BlockCard block={data} />;
		case "diff":
			return <BlockDiff block={data} />;
		case "checklist":
			return <BlockChecklist block={data} />;
		case "media_gallery":
			return <BlockMediaGallery block={data} />;
		case "file":
			return <BlockFile block={data} />;
		case "audio":
			return <BlockAudio block={data} />;
		case "html_widget":
			return <BlockHtmlWidget block={data} />;
		case "interactive":
			return <BlockInteractive block={data} />;
		default:
			return <RichFallback kind={String(block.kind)} reason="未知富块类型" />;
	}
}

export function RichBlocks({ extra }: { extra?: RichMessageExtra }) {
	const blocks = Array.isArray(extra?.blocks) ? extra.blocks.slice(0, MAX_BLOCKS) : [];
	if (blocks.length === 0) return null;
	const hidden = (extra?.blocks.length ?? 0) - blocks.length;
	return (
		<div className="st-rich-blocks">
			{blocks.map((block, index) => (
				<RichBlockView key={block.id || `block-${index}`} block={block} />
			))}
			{hidden > 0 ? <p className="st-rich-note">还有 {hidden} 个富块未展示</p> : null}
		</div>
	);
}
