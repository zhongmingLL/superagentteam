import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessageContent } from "@/components/chat/MessageContent";
import { shouldFoldMarkdown } from "@/components/chat/CollapsibleMarkdown";

describe("markdown message content", () => {
	it("renders headings, lists, tables, code, links and task items", () => {
		const content = [
			"# Title",
			"",
			"**bold** and *em* with `inline`",
			"",
			"- one",
			"- two",
			"- [x] done",
			"",
			"| A | B |",
			"| --- | --- |",
			"| 1 | 2 |",
			"",
			"```ts",
			"const answer = 42;",
			"```",
			"",
			"[link](https://example.com)",
		].join("\n");
		const { container } = render(<MessageContent content={content} />);

		expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeInTheDocument();
		expect(screen.getByText("bold").tagName).toBe("STRONG");
		expect(screen.getByText("em").tagName).toBe("EM");
		expect(screen.getByText("inline").className).toContain("st-inline-code");
		expect(screen.getAllByRole("listitem")).toHaveLength(3);
		expect(container.querySelector('input[type="checkbox"]')).toBeChecked();
		expect(screen.getByRole("table")).toBeInTheDocument();
		expect(screen.getByText("const answer = 42;")).toBeInTheDocument();
		const link = screen.getByRole("link", { name: "link" });
		expect(link).toHaveAttribute("href", "https://example.com");
		expect(link).toHaveAttribute("target", "_blank");
	});

	it("highlights @mentions without changing the text", () => {
		const { container } = render(<MessageContent content="hello @agentA, and @agentB." />);
		const mentions = [...container.querySelectorAll(".st-mention")].map((node) => node.textContent);
		expect(mentions).toEqual(["@agentA", "@agentB"]);
		expect(container).toHaveTextContent("hello @agentA, and @agentB.");
	});

	it("highlights mentions adjacent to CJK text without breaking emails", () => {
		const { container } = render(
			<MessageContent content="你好@agentA，邮箱 user@example.com 不应高亮" />,
		);
		const mentions = [...container.querySelectorAll(".st-mention")].map((node) => node.textContent);
		expect(mentions).toEqual(["@agentA"]);
		expect(container).toHaveTextContent("user@example.com");
	});

	it("skips raw HTML and does not keep javascript links", () => {
		const { container } = render(
			<MessageContent content={'<script>alert("x")</script>\n\n[bad](javascript:alert(1))'} />,
		);
		expect(container.querySelector("script")).toBeNull();
		const link = container.querySelector("a");
		expect(link?.textContent).toBe("bad");
		expect(link?.getAttribute("href") ?? "").not.toContain("javascript");
	});

	it("folds long markdown and toggles expand/collapse", () => {
		const long = Array.from({ length: 21 }, (_, index) => `line ${index + 1}`).join("\n");
		expect(shouldFoldMarkdown(long)).toBe(true);
		render(<MessageContent content={long} collapsible />);
		const expand = screen.getByRole("button", { name: "展开" });
		fireEvent.click(expand);
		expect(screen.getByRole("button", { name: "收起" })).toBeInTheDocument();
	});

	it("does not add a fold control to short content", () => {
		expect(shouldFoldMarkdown("one\ntwo")).toBe(false);
		render(<MessageContent content="one\ntwo" collapsible />);
		expect(screen.queryByRole("button", { name: "展开" })).toBeNull();
	});
});
