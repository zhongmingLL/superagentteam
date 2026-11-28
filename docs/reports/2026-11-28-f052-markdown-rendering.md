---
title: "F052 Markdown rendering — implementation report"
doc_kind: report
status: active
created: 2026-11-28
updated: 2026-11-28
source_decision: "operator 2026-11-28: agent 回答 Markdown 未渲染；参考 Clowder；增加长消息折叠与 @mention 高亮"
---

# F052 Markdown rendering — implementation report

## 背景

SuperAgentTeam 原 `MessageContent` 只用正则拆 fenced code，其余文本按
`white-space: pre-wrap` 直接显示。Agent 回答里的标题、列表、表格、粗体、链接都不会
渲染。operator 要求按 Clowder 的做法处理，并增加长消息折叠与 @mention 高亮。

## Clowder 参考

- `packages/web/src/components/MarkdownContent.tsx`：`react-markdown@10.1` +
  `remark-gfm` + `remark-breaks`；自定义 heading/list/table/code/link 组件；
  默认不启用 raw HTML；代码块复制；mention/文件链接为增强层。
- `packages/web/src/components/CollapsibleMarkdown.tsx`：超过 20 行折叠，
  max-height 320px，展开/收起。

## 本次实现

- 依赖：`react-markdown@10.1.0`、`remark-gfm@4.0.1`、`remark-breaks@4.0.0`。
- `MarkdownContent.tsx`：
  - p/strong/em/del/h1–h6/ul/ol/li/blockquote/a/hr/pre/code/table/th/td/img；
  - GFM 表格、任务列表、删除线；
  - fenced code 保持等宽、横向滚动；inline code 独立样式；
  - 链接 http(s) 新窗口 + `noreferrer noopener`；raw HTML 不执行；
  - `@handle` 文本高亮 `.st-mention`，不进入 code/pre。
- `CollapsibleMarkdown.tsx`：20 行阈值；折叠 max-height 320px；展开/收起按钮。
- `MessageContent` 增加 `collapsible`；主消息、private A2A、cross_post 使用；
  thinking/rich block 保持不折叠。

## 验证

- web 26 files / 125 tests passed；tsc + vite build passed。
- 测试覆盖：heading/list/table/code/link/task list、raw HTML 安全、javascript 链接、
  @mention、20 行折叠/展开、短消息不折叠。
- 真实 Kimi 隔离栈（3007/3016）：markdown 文档渲染 h1/bold/em/inline code、
  GFM 表格、fenced code、@f037b pill、22 行折叠；1440/390 无横向滚动。
- 截图：`docs/design/F052/`。

## 限制

- v1 不含 math/KaTeX、Mermaid、workspace/文件路径链接、agent 注册表 mention 颜色。
- bundle 从 ~621KB 增至 ~826KB（gzip ~238KB）；后续可做按需加载。

[宪宪/deepseek-flash🐾]
