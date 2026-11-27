---
feature_ids: [superagentteam/F042]
related_features: [superagentteam/F037, superagentteam/F041]
title: "F042: Session/CSRF recovery after daemon restart"
status: implemented
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: []
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-27
updated: 2026-11-27
source_decision: "operator 2026-11-27: 内网穿透发消息/创建 thread 报 invalid CSRF token；刷新页面才恢复"
---

# F042: Session/CSRF recovery after daemon restart

## Why

daemon 的 browser session 存在内存里，重启（每次部署都会发生）后全部失效。已经打开的
Hub 页面还持有旧会话的 CSRF token；下一次写请求到达 daemon 时：

1. 旧 session cookie 已查不到；
2. 代理链下 `devAutoLogin` 认为请求来自 loopback，于是创建一个**新** session；
3. 请求携带的是旧 CSRF，和新 session 不匹配 → 403 `csrf_failed`；
4. 浏览器 cookie 已换成新 session，但页面里的 CSRF 仍是旧的，重试继续 403。

用户只能手动刷新页面恢复。每次部署都会踩一次。

## 用户结果

- daemon 重启后，已打开的 Hub 页面在下一次写操作时自动恢复：重新取
  `/api/session`、更新 CSRF、重试一次，动作成功，无需手动刷新。
- 若重新认证失败（例如 auto-login 关闭），仍抛出原始错误，不无限重试。

## 范围

- API client：新增可选 `refreshCsrfToken`；收到 403 `csrf_failed` 时调用一次，
  成功则用新 token 重试同一请求一次（body 仅限 `undefined` 或字符串）。
- singleton：重取 `/api/session`，成功后更新 token 模块。
- 测试：403 → refresh → 用新 token 重试成功；refresh 失败抛原始错误；只重试一次。
- 文档与 BACKLOG。

## 非目标

- 不做 session 跨 daemon 重启持久化。
- 不放宽 CSRF/session 安全模型，不对其他 4xx 重试。
- 不改 daemon 鉴权逻辑。

## 验收

- [x] AC-1：首个写请求 403 `csrf_failed`，refresh 成功后重试携带新 `x-csrf-token` 并成功。
- [x] AC-2：refresh 返回 false 时抛原始 403，不发出第二次请求。
- [x] AC-3：最多重试一次；重试后仍 403 直接抛出。
- [x] AC-4：web tests / typecheck / build 绿。
- [x] AC-5：live 穿透页面在模拟会话丢失（清 cookie）后，无需手动刷新即可恢复写入。

## 风险

- 只在 daemon 明确返回 `403 csrf_failed` 时重试；该错误在路由处理前产生，首次请求没有
  业务副作用，重试不会重复写入。
- 只对可复用 body（字符串 JSON）重试，避免 FormData/流被重复消费。

## 进展（2026-11-27）

- 实现：API client 新增 `refreshCsrfToken`；403 `csrf_failed` 且未重试、body 可复用时，
  刷新一次并用新 token 重试一次。singleton 通过 `GET /api/session` 刷新 token。
- 测试：api-client 7 passed（新增 3 条：刷新后重试成功、刷新失败抛原始错误、只重试一次）。
- 全量 web tests 通过；typecheck 通过。
- 复审：墨墨 approve `2c9dc4436`（CI 5/5）。
- 合入：PR #232 merged `79f06685a`；runtime web 已部署 `79f06685a`（daemon 未重启，会话保留）。
- Live AC-5（`https://agentteam.hn.takin.cc`，Playwright）：打开 thread 后清空 cookie，
  直接发送消息；网络序列 `POST /api/messages 403 → GET /api/session 200 →
  POST /api/messages 202`，消息出现在 thread，全程未手动刷新。
- 剩余：operator 验收。
