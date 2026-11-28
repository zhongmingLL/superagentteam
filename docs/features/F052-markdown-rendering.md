---
feature_ids: [superagentteam/F052]
related_features: [superagentteam/F037, superagentteam/F043, superagentteam/F046]
title: "F052: Markdown-rendered agent messages"
status: implemented
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: []
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-28
updated: 2026-11-28
source_decision: "operator 2026-11-28: agent 回答都是 Markdown，当前直接呈现文字没有渲染；参考 Clowder；增加长消息折叠与 @mention 高亮"
---

# F052: Markdown-rendered agent messages

## Why

Agent 回答以 Markdown 为主（标题、列表、表格、代码、粗体、链接），当前
`MessageContent` 只用正则拆 fenced code，其余文本 `white-space: pre-wrap` 直接显示。
operator 验收时明确指出“没有渲染”，并要求对齐 Clowder 的做法。

Clowder 参考：`packages/web/src/components/MarkdownContent.tsx` 使用
`react-markdown` + `remark-gfm` + `remark-breaks`，自定义 heading/list/table/code/link
组件；`CollapsibleMarkdown.tsx` 对超过 20 行的消息折叠；文本节点做 @mention 高亮。

## 范围

- 用 `react-markdown` + `remark-gfm` + `remark-breaks` 渲染消息正文。
- 自定义组件：p/strong/em/del/h1–h6/ul/ol/li/blockquote/a/hr/pre/code/table/th/td/
  task checkbox；代码块保留等宽与横向滚动；表格横向滚动。
- 长消息折叠：超过 20 行显示“展开/收起”（CollapsibleMarkdown）。
- @mention 高亮：对正文中的 `@handle` 做 pill 高亮；不改变原始文本。
- 安全：不启用 raw HTML；链接使用 react-markdown 默认 URL 过滤。

## 非目标

- v1 不引入 math/KaTeX、Mermaid、文件路径/workspace 链接、agent 注册表颜色映射。
- 不改消息存储、A2A 协议、工具或 daemon。

## 验收

- [x] AC-1：标题、列表、表格、粗体/斜体、链接、inline code、fenced code 正确渲染。
- [x] AC-2：raw HTML 不执行（按文本显示）；`javascript:` 链接被过滤。
- [x] AC-3：超过 20 行的消息默认折叠，显示“展开”；展开后“收起”。
- [x] AC-4：正文 `@handle` 显示高亮 pill，原文本不变；句末标点不吞进 pill；
  汉字紧邻（如“你好@a1”）也高亮，邮箱不误伤。
- [x] AC-5：web 26 files / 125 tests + build 绿；真实 Hub 1440/390 预览通过；
  非作者 review 待 PR。

## 实现

- `MarkdownContent.tsx`：`react-markdown@10.1.0` + `remark-gfm@4.0.1` +
  `remark-breaks@4.0.0`；自定义 p/heading/list/table/code/link/blockquote/task list；
  raw HTML 不启用 rehype-raw；`javascript:` 链接由 react-markdown URL 过滤。
- `CollapsibleMarkdown.tsx`：`TEXT_FOLD_THRESHOLD=20`，折叠 max-height 320px，
  “展开/收起”。
- @mention：文本节点 `@handle` 高亮为 `.st-mention` pill；不进入 code/pre。
- `MessageContent` 增加 `collapsible`；主消息、private A2A、cross_post 使用。

## 证据

- web 125/125（26 files）；tsc + vite build 绿。
- 真实 Kimi `F052 Markdown preview`：h1、bold/em/inline code、列表、GFM 表格、
  fenced code、@f037b pill、22 行长内容折叠/展开全部实测。
- 截图：
  - `docs/design/F052/f052-markdown-top-1440.png`
  - `docs/design/F052/f052-markdown-collapsed-1440.png`
  - `docs/design/F052/f052-markdown-390.png`
- 报告：[`2026-11-28-f052-markdown-rendering.md`](../reports/2026-11-28-f052-markdown-rendering.md)。

## 风险 / 回滚

- 新依赖 `react-markdown`/`remark-gfm`/`remark-breaks`：版本固定，CI/build 验证。
- bundle 体积从 ~621KB 增至 ~826KB（gzip ~238KB）；后续可做按需加载。
- 样式回归：所有 markdown 样式限定在 `.st-message-content` 下。
- 回滚：revert 本 feature；消息数据不变。

[宪宪/deepseek-flash🐾]
