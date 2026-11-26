---
feature_ids: [superagentteam/F039]
related_features: [superagentteam/F036, superagentteam/F037, superagentteam/F038]
title: "F039: Conversation layout polish — header divider & message metadata"
status: implemented
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: []
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-26
updated: 2026-11-26
source_decision: "operator 2026-11-26: 当前对话页 thread 名下方需要浅色分隔线；agent/operator 名字与时间放到气泡上方，operator 的名字叫 operator"
---

# F039: Conversation layout polish

## Why

F038 落地后，operator 在验收当前对话页时又给了两条具体的视觉反馈：

1. thread 名下方仍需要一根浅色分隔线，把标题区和对话内容分开。
2. agent 的名字/时间在气泡内部，operator 也一样；应统一移到气泡上方，
   并把 operator 的显示名从“你”改为 `operator`。

这两条只调整消息与标题的视觉层级，不改消息顺序、A2A、队列、取消、重命名或
rich block 语义。

## 用户结果

- 当前对话页 topbar 的 thread 名下方有一条清晰但轻量的分隔线，浅色/深色主题一致。
- agent 消息的作者名与相对时间位于气泡上方，气泡内只保留消息内容与执行记录。
- operator 消息同样把名字/时间放在气泡上方，显示名为 `operator`，头像使用 `O`。
- pending 发送态与 live 受理态沿用同一套元信息位置。

## 范围

- `MessageList`：引入 `.st-message-stack`，把 `.st-message-meta` 移到
  `.st-message-body` 外部；agent / operator / pending / live 统一。
- operator 显示名：`你` → `operator`；头像字母 `你` → `O`。
- `global.css`：调整 `.st-message` / `.st-message-body` 的宽度与对齐；
  topbar 分隔线使用更可见的 hairline-strong；1440/390 同步。
- 测试：覆盖 meta 位于气泡外、operator 标签、pending/live 结构。
- Pencil 设计稿同步：4 个 frame 的消息元信息移到气泡上方，thread 标题下加分隔线，
  重新导出 PNG 并更新 F038/F039 证据。

## 非目标

- 不改消息排序、分页、已读、A2A dispatch/cancel/retry 语义。
- 不做全局 i18n；只把 operator 的身份标签从“你”改为 `operator`。
- 不改 system/multi-mention 消息的徽章与聚合逻辑。
- 不引入新的消息字段或后端契约。

## 验收

- [x] AC-1：1440/390、浅色/深色下，thread 名下方有可见的浅色分隔线。
- [x] AC-2：agent 与 operator 的姓名/时间都在气泡上方，DOM 上不在
      `.st-message-body` 内；气泡内不再重复显示元信息。
- [x] AC-3：operator 消息显示 `operator`，不再显示“你”；头像为 `O`。
- [x] AC-4：pending 发送态与 live 受理态使用相同的元信息位置。
- [x] AC-5：web tests / typecheck / build 绿；1440/390 截图；非作者视觉 review。
- [x] AC-6：Pencil 设计源与 4 张导出图同步更新，重新导出一致。

## 风险

- meta 移出气泡会改变消息行高与滚动位置；保留置底逻辑并做截图验证。
- operator 标签改动可能影响依赖“你”的旧截图/文案；更新测试与证据。
- 390 下 meta + 气泡的宽度需要重新约束，避免横向滚动。

## 进展（2026-11-26）

- 实现：`MessageList` 增加 `.st-message-stack`，agent/operator/pending/live 的
  meta 移到气泡外；operator 显示名改为 `operator`，头像 `O`。
- 样式：`.st-topbar` 分隔线提升到 `--st-hairline-strong`；390/1440 同步。
- 测试：web 114 passed（25 files）；web typecheck / `build:offline` 通过。
- 视觉：`docs/design/F039/` 下 1440/390 浅色/深色截图。
- Pencil：4 个 frame / 365 nodes / 61 variables；Thread 1440/390 已加顶部分隔线、
  消息 meta 移到气泡上方，operator 标签改为 `operator`；4 张 PNG 重新导出。
- 证据：`docs/reports/2026-11-26-f039-conversation-layout-polish.md`。
- 非作者 review：墨墨 approve `791c54c7a`；独立复核 web 114 / typecheck / doc index /
  CI 5/5 / 4 张实机截图。
- PR #218 landed `9e005c416`；F039 进入 `superagentteam-work`。
- operator 后续反馈（thread 更多操作菜单、分隔线下移到项目路径下方、侧栏副标题移除）
  转 F040 继续；F040 已把 topbar border 改为项目路径行后的 `.st-thread-divider`。

[宪宪/deepseek-flash🐾]
