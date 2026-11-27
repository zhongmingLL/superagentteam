---
feature_ids: [superagentteam/F041]
related_features: [superagentteam/F033, superagentteam/F037]
title: "F041: Tunnel access for the Hub"
status: implemented
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: []
vision_guard: 墨墨 (Qwen 3.8 Flash)
created: 2026-11-27
updated: 2026-11-27
source_decision: "operator 2026-11-27: 我需要内网穿透连接 hub（agentteam.hn.takin.cc），Vite 报 Blocked request"
---

# F041: Tunnel access for the Hub

## Why

operator 需要通过内网穿透域名 `agentteam.hn.takin.cc` 访问本机 Hub。当前有两道门把
穿透挡在外面：

1. Vite dev server 拒绝未知 Host（`Blocked request. This host is not allowed`）。
2. daemon 的 browser API 对非 loopback Origin 要求与 `hubOrigin` 精确相等；穿透页面的
   `https://agentteam.hn.takin.cc` 会被 403 `origin not allowed`，写请求全部失败。

localhost 访问必须保持原样，不能为了穿透把 daemon 改成只认穿透域名。

## 用户结果

- 在 runtime env 中配置穿透域名后，`https://agentteam.hn.takin.cc` 能加载 Hub，
  并且创建/发送/设置等写操作可用。
- 本机 `http://localhost:3005` 行为不变。
- 未配置时行为不变：Vite 仍拒绝未知 Host，daemon 仍只接受 `hubOrigin`（含 loopback 别名）。

## 范围

- `vite.config.ts`：从 `SUPERAGENTTEAM_ALLOWED_HOSTS`（逗号分隔）读取
  `server.allowedHosts`；空值不放开任何 host。
- daemon：新增可选 `hubOrigins`（额外允许的 browser Origin）；`hubOrigin` 仍是主 origin，
  用于重定向和 console link。Origin 校验改为对允许列表逐个精确匹配（loopback 别名规则不变）。
- daemon：允许列表含任何非 loopback origin 时，`devAutoLogin` 默认关闭；只有显式
  `SUPERAGENTTEAM_DEV_AUTO_LOGIN=1` 才保留自动登录，loopback-only 场景行为不变。
- `/auth/console`：成功后优先重定向到请求中已验证的 Origin；否则按 Host 匹配允许列表；
  都不匹配时回 `hubOrigin`，避免远程登录后跳到不可达的 localhost。
- `runtime-daemon.mjs`：从 `SUPERAGENTTEAM_HUB_ORIGINS`（逗号分隔）读取额外 origin。
- 测试：多 origin allowlist 命中、未知 origin 拒绝、localhost 行为不回归、
  外部 origin 下 auto-login 默认关闭/显式 opt-in、console-link 重定向选择。
- 部署：runtime env 增加 `SUPERAGENTTEAM_ALLOWED_HOSTS` 与
  `SUPERAGENTTEAM_HUB_ORIGINS`，重启 3005/3014 后实测。
- 部署决策（operator 2026-11-27）：穿透域名仅 operator 本人访问，为免登录摩擦，
  runtime env 显式 `SUPERAGENTTEAM_DEV_AUTO_LOGIN=1`；代码默认收紧不变。

## 非目标

- 不引入通配符 Origin，不把 `allowedHosts` 设为 `true`。
- 不改 session/CSRF 模型，不新增登录方式；只在外部 origin 场景收紧 devAutoLogin 默认值。
- 不负责 TLS 终止与穿透隧道本身（由 operator 的穿透服务承担）。
- 不放宽 daemon 的监听地址（仍只绑 loopback，由 Vite/穿透入口对外）。

## 验收

- [x] AC-1：配置 `SUPERAGENTTEAM_ALLOWED_HOSTS=agentteam.hn.takin.cc` 后，
  `curl -H 'Host: agentteam.hn.takin.cc' http://127.0.0.1:3005/` 返回 200。
- [x] AC-2：配置 `SUPERAGENTTEAM_HUB_ORIGINS=https://agentteam.hn.takin.cc` 后，
  带该 Origin 的 `/api/session` 返回 200；未知 Origin 仍 403。
- [x] AC-3：localhost:3005 的读写行为不变。
- [x] AC-4：daemon 定向测试覆盖允许列表与拒绝路径。
- [x] AC-6：允许列表含非 loopback origin 时，未显式 `SUPERAGENTTEAM_DEV_AUTO_LOGIN=1`
  的 `/api/session` 返回 401；显式 opt-in 后返回 200。
- [x] AC-7：隧道 Host/Origin 的 console exchange 302 到隧道 origin；未知 Host 回 hubOrigin。
- [x] AC-5：live 3005/3014 重启后实测穿透 Host/Origin 通过，本机页面无回归。

## 风险

- Origin allowlist 是安全边界：只允许精确匹配，不引入通配符；空值/空白项忽略。
- 代理链下 daemon 看到的 remoteAddress 恒为 loopback，不能仅凭 socket 地址判断真实来源；
  外部 origin 存在时默认关闭 devAutoLogin，避免穿透访客无凭据获得 operator session。
- 穿透域名进入 runtime env（本机 0600），不写成产品代码里的硬编码常量。
- Vite `allowedHosts` 只影响 dev server 的 Host 校验，不改变生产构建。

## 进展（2026-11-27）

- 实现：`vite.config.ts` 从 `SUPERAGENTTEAM_ALLOWED_HOSTS` 读取 `server.allowedHosts`；
  daemon 新增 `hubOrigins` 额外 Origin 白名单，`isAllowedOrigin` 支持列表逐个精确匹配；
  `runtime-daemon.mjs` 从 `SUPERAGENTTEAM_HUB_ORIGINS` 读取。
- 测试：`api-session` + `f026-dev-auto-login` + `f041-tunnel-access` 22 passed；新增
  tunnel origin 命中、未知 origin 403、localhost 不回归、auto-login 收紧与 console
  redirect 选择的用例。
- Vite 烟测：配置后 tunnel Host 200 / evil Host 403；未配置时 tunnel Host 403 /
  localhost 200（`--noproxy` 排除本机代理干扰）。
- Daemon 烟测（临时数据目录，端口 3021，`runtime-daemon.mjs` 入口）：
  tunnel Origin 200 / evil Origin 403 / localhost Origin 200。
- Review（墨墨 `cb00ad103`，changes_requested）：P1 发现代理链下 `devAutoLogin` 会被
  loopback 伪装击穿（任何穿透访客无凭据获得 operator session），P2 发现 console-link
  远程会跳到 localhost。已按建议修复：外部 origin 默认关闭 auto-login（显式 opt-in 才能开）；
  console redirect 选择已验证的请求 Origin/Host。
- 复审：墨墨 approve `f19728715`（CI 5/5）。
- 合入：PR #229 merged `25dab74ff`；runtime worktree 已部署 `25dab74ff` 并重建 daemon dist。
- Live 实测（`https://agentteam.hn.takin.cc`）：
  - 页面 200；无凭据 `/api/session` 401（P1 收紧生效）；evil Origin 403。
  - console exchange 302 到 `https://agentteam.hn.takin.cc`，cookie 建立后
    `/api/session` 200；带 cookie+CSRF 的写请求返回 400 invalid_input（origin/session/CSRF
    门禁全部通过，不是 403）。
- Operator 决策后（`SUPERAGENTTEAM_DEV_AUTO_LOGIN=1`，2026-11-27）：重启后公共
  `/api/session` 无凭据 200（免登录恢复）；写请求仍 400 invalid_input（门禁通过）。
- runtime env（本机 0600）：`SUPERAGENTTEAM_ALLOWED_HOSTS=agentteam.hn.takin.cc`、
  `SUPERAGENTTEAM_HUB_ORIGINS=https://agentteam.hn.takin.cc`、
  `SUPERAGENTTEAM_DEV_AUTO_LOGIN=1`（operator 私有穿透决策）。
- 剩余：operator 直接用穿透地址验收（免登录）。
