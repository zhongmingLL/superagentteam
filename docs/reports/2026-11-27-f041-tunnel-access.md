---
title: "F041 tunnel access — verification report"
doc_kind: report
status: done
created: 2026-11-27
updated: 2026-11-27
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
---

# F041 tunnel access — verification report

## 背景

operator 需要通过内网穿透域名 `agentteam.hn.takin.cc` 访问 3005 Hub。原实现有两道门：
Vite 拒绝未知 Host；daemon 对非 loopback Origin 只接受单一 `hubOrigin`，写请求 403。

## 交付

- Vite `server.allowedHosts` 从 `SUPERAGENTTEAM_ALLOWED_HOSTS` 读取。
- daemon 新增 `hubOrigins` 额外 Origin 白名单（精确匹配，无通配符）。
- `runtime-daemon.mjs` 从 `SUPERAGENTTEAM_HUB_ORIGINS` 读取。
- 安全收紧（review P1）：允许列表含非 loopback origin 时 `devAutoLogin` 默认关闭；
  只有显式 `SUPERAGENTTEAM_DEV_AUTO_LOGIN=1` 才 opt-in。
- console-link（review P2）：302 目标优先用已验证的请求 Origin，其次 Host 命中 allowlist
  的 origin，否则回 `hubOrigin`。

## 坐标

- PR: #229 merged `25dab74ff`
- reviewed HEAD: `f19728715`（墨墨 approve，取代 `cb00ad103` 的 changes_requested）
- live runtime: 3005/3014 @ `25dab74ff`

## 验证

| 检查 | 结果 |
|---|---|
| daemon 全量 tests | 515 passed / 1 skipped |
| web tests | 116 passed |
| tsc / doc-index | pass（51 docs / 41 rows） |
| Vite：tunnel Host / evil Host | 200 / 403 |
| daemon：tunnel Origin 无凭据 / evil Origin | 401 / 403 |
| public page | 200 |
| public `/api/session` 无凭据（默认 `=0`） | 401 |
| console exchange（public tunnel） | 302 → `https://agentteam.hn.takin.cc`，cookie 建立 |
| session with cookie | 200 |
| write with cookie+CSRF+tunnel Origin | 400 invalid_input（门禁通过，非 403） |
| public `/api/session` 无凭据（operator opt-in `=1`） | 200 |

## 安全说明

- Origin allowlist 严格精确匹配；空项忽略；无通配符、无 `allowedHosts: true`。
- 代理链下 daemon 看到的是 loopback socket，因此不能依赖 socket 地址判断真实来源；
  外部 origin 存在时代码默认关闭 auto-login。
- operator 明确该穿透域名仅供其本人访问；部署时显式 `SUPERAGENTTEAM_DEV_AUTO_LOGIN=1`，
  因此 live 对穿透与 localhost 免登录。该 opt-in 是部署决策，代码默认收紧不变；
  若穿透域名未来公开，应撤销该 opt-in。

## 剩余

- operator 直接用穿透地址验收（免登录）。

[宪宪/deepseek-flash🐾]
