---
feature_ids: [superagentteam/F026]
related_features: [superagentteam/F020, superagentteam/F025]
title: "F026: Local dev auto-login — Clowder-compatible localhost UX"
status: done
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: [砚砚 (GLM 5.3 Flash)]
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-23
updated: 2026-11-24
source_decision: "operator 2026-11-23: 保持和 clowder-ai 一致；本地开发直接 http://localhost:xxxx，不要每次 console-link"
---

# F026: Local dev auto-login — Clowder-compatible localhost UX

## Why

Clowder AI 的本地 Hub 无 cookie 时落 `default-user`，所以 `http://localhost:xxxx`
直接可用。SuperAgentTeam 的 console-link 模型更严格（operator credential +
短期单次 token + HttpOnly session + CSRF），但在“还不是最终产品”的本地开发阶段
太麻烦：daemon 每次重启/会话过期都要重新生成一条长链接。

operator 2026-11-23 明确要求本地开发保持和 Clowder 一致的直接访问体验。

## 用户结果

- 本地启动器启动后，浏览器直接打开 `http://localhost:<port>/` 即可使用；
  不再需要 console link。
- 首次 `/api/session` 自动建立 operator 会话（使用现有 operator fingerprint），
  浏览器拿到 HttpOnly session cookie + CSRF token。
- 写操作仍然要求 CSRF；不是“完全无认证的写面”。

## 范围

- `devAutoLogin` 开关（默认 **false**；F025 本地启动器默认开启）。
- 仅接受 loopback 请求（`127.0.0.1` / `::1` / `::ffff:127.0.0.1`）。
- 无/过期 session 时自动创建会话；userId 使用
  `operator:<operator fingerprint>`，保证已有 thread/数据归属不变。
- 保留 Origin allowlist、HttpOnly/SameSite=Strict cookie、CSRF。
- 生产/测试默认不走 auto-login；`devAutoLogin:false` 仍返回 401。

## 开关

- daemon 和 F025 launcher 都读同一个环境变量 `SUPERAGENTTEAM_DEV_AUTO_LOGIN`；
  代码里的 `envValue(..., "DEV_AUTO_LOGIN")` 只是统一前缀 helper，不是第二个变量。
- F025 launcher 默认开启；设 `SUPERAGENTTEAM_DEV_AUTO_LOGIN=0` 即关闭。
- 直接调用 `startDaemon` 时可显式传 `devAutoLogin: true/false`。

## 非目标

- 不做持久化 session（daemon 重启仍会重建会话，但 dev 模式下无感）。
- 不做多用户/账号体系；不改变 operator credential/console-link 的正式模型。
- 不允许非 loopback 请求匿名；不做 LAN 暴露。

## 验收标准

- devAutoLogin=true + loopback + 无 cookie：`GET /api/session` 200，返回
  `{userId, csrfToken}` 并 `Set-Cookie`；`/api/agents` 200。
- devAutoLogin=true + loopback + 过期/无效 cookie：自动换新 session，不 401。
- devAutoLogin=false：无 cookie 仍 401（现有行为）。
- POST 写面在 dev 模式下仍要求 CSRF；缺 CSRF 403。
- 直接打开 `http://localhost:<port>/` 可用；不再需要 console link。
- daemon 测试、web 测试、tsc/build/doc-index 全绿。

## 安全边界

- 只在显式开关或本地启动器开启；代码默认关闭。
- 只对 loopback 生效；远程地址不落默认用户。
- 仍然保留 Origin allowlist、CSRF、HttpOnly/SameSite=Strict cookie。
- 正式产品/远程部署继续使用 console-link 模型。

## 进展

- 2026-11-23：PR #165 merged `055182d670`；砚砚 security review
  `approve @ 4d0d24172`（gate 顺序、socket loopback 判定、operator fingerprint、
  默认关闭、CSRF/cookie 均核过）。
- Windows 侧 dev stack 实测：无 cookie `GET /api/session` 200 + Set-Cookie，
  `/api/agents` 200，`/api/threads` 两个 F025 thread 都在；直接
  `http://localhost:3101/` 可用，无需 console link。
- P3 备案：P3-A 两层开关命名已在「开关」段澄清；P3-B 每个无 cookie 请求会
  新建 session（loopback-only，idle 15min 自清）接受，不阻塞。
- 2026-11-24：operator batch close（消息 `0001795523064349-000942-d9449e06`）；
  F025–F031 一起收口，状态 → done。

[宪宪/deepseek-flash🐾]
