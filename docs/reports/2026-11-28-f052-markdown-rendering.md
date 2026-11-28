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
- `@handle` 文本高亮 `.st-mention`，不进入 code/pre；边界类含汉字区段，
  “你好@a1”可高亮，邮箱 `user@example.com` 不误伤。
- `CollapsibleMarkdown.tsx`：20 行阈值；折叠 max-height 320px；展开/收起按钮。
- `MessageContent` 增加 `collapsible`；主消息、private A2A、cross_post 使用；
  thinking/rich block 保持不折叠。

## 验证

- web 26 files / 126 tests passed；tsc + vite build passed。
- 测试覆盖：heading/list/table/code/link/task list、raw HTML 安全、javascript 链接、
  @mention、20 行折叠/展开、短消息不折叠。
- 真实 Kimi 隔离栈（3007/3016）：markdown 文档渲染 h1/bold/em/inline code、
  GFM 表格、fenced code、@f037b pill、22 行折叠；1440/390 无横向滚动。
- 截图：`docs/design/F052/`。
- review：砚砚 approve base `a6eced447`，P3 delta（CJK 紧邻 @）`b0195b60a` approve；
  PR #271 merged `af82e157`；runtime 3005/3014 已部署并验证真实 Markdown 消息。
- runtime 实测：`a2a-测试2` agentD 的 h2/h3/GFM 表格/bold/list/inline code 正常渲染，
  长内容显示“展开”；截图 `f052-runtime-markdown-1440.png`。

## 字体栈跟进（2026-11-28）

operator 反馈 Markdown 正文的数字/字母不好看，并问 Clowder 使用什么字体。核对结论：

- Clowder 正文声明 `"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`，
  但仓库没有自托管 Inter（无 `@font-face` / `next/font` 加载）；实际观感来自 OS 系统字体
  （macOS SF Pro / Windows Segoe UI）。Clowder 只在排行榜自托管 Fraunces 与 Plus Jakarta Sans。
- SAT 同样声明 Inter 但从未加载；且原回退顺序把 `"PingFang SC"` / `"Noto Sans CJK SC"`
  放在 Latin 系统字体之前，缺少 Inter 的机器上数字/字母会落到 CJK 字体或 Arial/DejaVu。

修复：

- 自托管 Inter Variable（latin + latin-ext 两个 woff2，SIL OFL 1.1，来源与 SHA 记录在
  `packages/superagentteam-web/src/assets/fonts/PROVENANCE.md`），`font-display: swap`。
- `--st-font-body` / `--st-font-display` 回退顺序改为
  `Inter → SF/Segoe UI/Roboto/Helvetica/Arial → PingFang/Noto CJK → sans-serif`。
- `.st-message-content` 字号 13px → 14px，对齐 Clowder Markdown 的 `text-sm`。
- 预览：`docs/design/F052/f052-font-before-1440.png` / `f052-font-after-1440.png`
  （runtime 3005 同一 thread，只读注入对比，不改运行时数据）。
- 验证：web 26 files / 126 tests passed；tsc + vite build passed；字体产物
  `Inter-Variable-latin` 48KB + `-latin-ext` 85KB。
- 合入与部署：PR #274 merged `5c6db6a5e`；砚砚 approve @ `a3a52bce1`，CI 5/5。
  runtime 3005/3014 已重启到 `5c6db6a5e`，health `ready`。
- 部署后实测（同一 thread，无注入）：`document.fonts` = `Inter:loaded`；
  正文 14px / line-height 22.4px；1440 与 390 均无横向滚动。
  截图：`f052-font-deployed-1440.png` / `f052-font-deployed-390.png`。

## 限制

- v1 不含 math/KaTeX、Mermaid、workspace/文件路径链接、agent 注册表 mention 颜色。
- bundle 从 ~621KB 增至 ~826KB（gzip ~238KB）；后续可做按需加载。

[宪宪/deepseek-flash🐾]
