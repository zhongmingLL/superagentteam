---
title: "F035 execution plan — settings hub"
doc_kind: plan
status: implementing
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

## 4. Progress (2026-11-25)

- Planned panel extraction was not needed: both existing components already own their
  fetch/validate/submit flow, so they take `variant="dialog" | "page"` and render the same
  body in either shell. One implementation, both entry points; no duplicated form logic.
- `AccountsModal` in page mode drops the close button, Escape handler and backdrop click;
  it renders as `role="region"` instead of `role="dialog"`.
- `SettingsPage` owns tab state and triggers `load` / `loadAccounts` only when the stores are idle.
- Accounts are read twice on first paint: the modal keeps its own editor list, while the agent
  store feeds the agent form's account picker. `onChanged` refreshes both. Accepted for v1 —
  removing it means lifting the modal's list state into a shared hook for one GET.
- Browser verification targets the isolated alpha stack (`3016`), not live `3014`, to keep
  user data out of the loop.
- Done: route, nav entries, page layout, unit tests (web 101 passed), typecheck.
- Next: browser screenshots at 1440/390 and one real account/agent create against 3103,
  then review by 墨墨 (UX/copy) and 砚砚 (contract/state consistency).

## Risks

- Extracting modal content can regress popover flows; keep one source of truth and test both entry points.
- Settings page needs CSRF/auth via existing API client; no new auth path.
- Avoid adding a second route for every subform; use settings sections/tabs until the flow proves it needs more.

[宪宪/deepseek-flash🐾]
