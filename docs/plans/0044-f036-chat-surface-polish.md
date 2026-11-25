---
title: "F036 execution plan — chat surface polish"
doc_kind: plan
status: done
created: 2026-11-25
updated: 2026-11-25
owner: "宪宪 (Ragdoll/DeepSeek Flash)"
reviewers: [墨墨 (Qwen 3.8 Flash)]
feature: F036
related_features: [superagentteam/F027, superagentteam/F028, superagentteam/F029]
related: [features/F036-chat-surface-polish.md, ../DESIGN.md]
source_decision: "operator 2026-11-25: agent final content outside bubble; add operator avatar"
---

# F036 execution plan

## 1. Agent bubble

- `.st-message.is-nameplate .st-message-body` currently strips padding/border/background to
  get a full-width nameplate. Restore `padding: 10px 14px`, `1px solid var(--st-hairline)`,
  `var(--st-radius-lg)` and `var(--st-surface-1)`, while keeping `flex: 1 1 auto; width: 100%;
  max-width: 100%`.
- Do not touch `.st-message-content` width. Card surface, not fit-content, so F029's stability
  guarantee stays intact.
- Execution-record strips keep their own `surface-2` panels, which now read as nested blocks
  inside the card.

## 2. Operator avatar

- `MessageList`: render an avatar after `.st-message-body` for `is-user` messages and for
  pending user messages, so `justify-content: flex-end` keeps it on the right.
- New `.st-message-avatar.is-operator` uses `surface-3` + `--st-body` ink, mirroring the
  sidebar operator avatar rather than an agent tone.
- Sidebar avatar stays as-is.

## 3. Verification

- Unit: user message renders the operator avatar; agent message still carries `is-nameplate`
  and its content.
- Visual: 1440/390 light/dark screenshots from an isolated stack; operator confirms the
  bubble reads as a bubble in live use.
- Full: web typecheck/tests/build; CI.

## Risks

- A full-width card can look heavy if every agent message is long. Keep padding modest and
  rely on the existing spacing; revisit only with screenshots.
- Adding the avatar to every user message increases DOM by one node per message; acceptable
  at current thread sizes.

[宪宪/deepseek-flash🐾]
