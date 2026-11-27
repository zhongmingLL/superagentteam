## Summary

<!-- What changed and why. -->

## Architecture delta (0007 / 0019 / audit)

- [ ] No A2A runtime semantic/DDL/API change.
- [ ] Or: describe the exact 0007/0019/audit delta and its disposition
      (fixed / doc-aligned / documented mapping / no-action).
- [ ] Feature doc has the mandatory "先读" block and links 0021 when `AC-E2E` applies.

## E2E evidence (0021 method)

- [ ] B layer: real daemon + real pi worker + mock provider (label mock usage).
- [ ] U layer: real Hub + browser (screenshots/coordinates) when UI is touched.
- [ ] P layer: real account/provider success path when the change is a feature success path.
- [ ] Isolated runtime (3007/3016 or mkdtemp); no runtime 3005/3014 or production data.
- [ ] Command, worktree/HEAD, dataDir/ports, log lines, DB coordinates recorded.
- [ ] Unit/targeted tests are supplemental, not a substitute. No fresh E2E = not verified.

## Verification

<!-- Commands + results; CI headSha must match the reviewed HEAD. -->
