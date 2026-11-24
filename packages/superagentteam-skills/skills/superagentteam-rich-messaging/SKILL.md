---
name: superagentteam-rich-messaging
description: Attach structured rich blocks to a response when they help the reader scan or act on the answer.
triggers: ["structured answer", "card", "checklist", "diff", "before creating a rich block"]
---

# SuperAgentTeam rich messaging

Use `superagentteam_create_rich_block` only when a structured block makes the answer easier to read. The text body remains the primary answer; rich blocks are supporting structure.

## Choose a block

| Kind | Use when | Minimum fields |
|---|---|---|
| `card` | One decision, result or summary with 2–6 facts | `title` or `bodyMarkdown` |
| `checklist` | Progress, acceptance items or next steps | `items: [{ id, text, checked? }]` |
| `diff` | Show a code change without pasting a whole file | `diff` |
| `media_gallery` | Show 1–8 images already available by URL | `items: [{ url, alt?, caption? }]` |
| `file` | Point at an existing file | `fileName` (+ optional `url`) |
| `audio` | Attach an existing audio URL or spoken text | `url` or `text` |
| `html_widget` | A small read-only visual; sandboxed iframe | `html` |
| `interactive` | Show options for a future decision; v1 is display-only | `options: [{ id, label, description? }]` |

Every block needs `{ id, kind, v: 1 }`. Use a stable id per block; repeating the same id replaces it, so retries do not duplicate.

## Rules

- Prefer 1–3 blocks. Never exceed 20 blocks or 64 KiB per block.
- Do not create `approval` or permission blocks; those are not part of this surface.
- Do not use a card or checklist to hide the actual answer. Write the answer first, then add the block.
- `interactive` options are display-only in v1. Never tell the reader they can click them.
- For `html_widget`, keep it self-contained and read-only. Do not put secrets or scripts that need network access in it.

## Example

```json
{
  "block": {
    "id": "review-summary",
    "kind": "card",
    "v": 1,
    "title": "Review summary",
    "bodyMarkdown": "One P1 remains; all P2/P3 findings are closed.",
    "fields": [
      { "label": "Verdict", "value": "changes requested" },
      { "label": "Head", "value": "12fa07a" }
    ]
  }
}
```

If the tool rejects the block, fix the named field or send the information as text. Do not silently drop the block and claim it was attached.
