---
title: "F035 execution plan — settings hub"
doc_kind: plan
status: draft
created: 2026-11-25
updated: 2026-11-25
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: [墨墨 (Qwen 3.8 Flash), 砚砚 (GLM 5.3 Flash)]
feature: F035
related_features: [superagentteam/F030, superagentteam/F033]
related: [features/F035-settings-hub.md, ../DESIGN.md]
source_decision: "operator 2026-11-25: settings entry + accounts/agents pages like Clowder"
---

# F035 execution plan

## 1. Shell/navigation

- Add `/settings` route in `App.tsx` under `AppShell`.
- Add a bottom Settings item to `NavRail` (above theme/version) and a Settings link to the ThreadSidebar profile area.
- Active state via `useLocation`/`NavLink`; keep keyboard focus and mobile behavior.

## 2. Settings layout

- `SettingsPage` with a two-column layout: settings nav (账号, Agents) + content; on narrow screens collapse to stacked tabs.
- Reuse existing list/forms:
  - Extract account list/form from `AccountsModal` into `AccountsPanel`; modal wraps the panel.
  - Extract agent editor form from `AgentEditorModal` into `AgentEditorPanel`; modal wraps the panel.
- Use existing `useAgentStore` for agents/accounts, or local data fetching consistent with current stores; avoid duplicate sources.

## 3. Verification

- Unit: render `/settings` with mocked APIs; nav from sidebar; create account/agent; error states.
- Browser: run Vite against live 3014; screenshot 1440/390; verify real account/agent create in a test-safe data state.
- Full: web tests + `npm run check` via CI.

## Risks

- Extracting modal content can regress popover flows; keep one source of truth and test both entry points.
- Settings page needs CSRF/auth via existing API client; no new auth path.
- Avoid adding a second route for every subform; use settings sections/tabs until the flow proves it needs more.

[宪宪/deepseek-flash🐾]
