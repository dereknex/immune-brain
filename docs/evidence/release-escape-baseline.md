# Release escape baseline: v8.6.0–v9.1.0

Evidence for Spec `docs/specs/e2e-release-gate.spec.md` D10 (`BR-DEC-E6`): the success metric is post-release fixes within 7 days per version. This is the baseline the L1 gate is measured against.

## How it was produced

```sh
bun scripts/release-escape-report.ts
```

Snapshot taken 2026-11-23 from the checkout of `imm-lane/e2e-release-gate/e2e-gate-s10-bump-and-metric`. The script lists, per `immune-brain-v*` tag, commits within 7 days after the tag whose subject starts `fix` or `repair`, or that declare `Fixes-release: <version>`, plus closed Issues labeled `bug` read through `gh`. A fix after the 7-day window is not counted. Rerun the command for a current figure; the table below is not updated automatically.

## Baseline

| Version | Tagged | Window closes | Fix commits | Bug issues | Escapes |
| --- | --- | --- | ---: | ---: | ---: |
| v8.6.0 | 2026-11-16 | 2026-11-23 | 1 | 0 | 1 |
| v9.0.0 | 2026-11-17 | 2026-11-24 (open) | 1 | 0 | 1 |
| v9.1.0 | 2026-11-17 | 2026-11-24 (open) | 2 | 0 | 2 |
| **Total** |  |  | 4 | 0 | 4 |

Rows marked (open) are still inside their window, so their counts can grow.


Rows marked (open) were still inside their window at the snapshot, so v9.0.0 and v9.1.0 counts were incomplete. Rerun after 2026-11-24 for their final figures.

Attributed commits at the snapshot:

- v8.6.0: e5a771b4631 `fix(review): report invalid agents config as review_config_invalid (#455)`
- v9.0.0: dbd9f4a09b5 `fix(review): submit review receipts through an MCP tool`
- v9.1.0: d979c219c75 `fix(no-touch): retire the docs/agents/no-touch.json declaration`
- v9.1.0: d27b97c1956 `fix(loop): fail closed on unreadable projections, persist GitHub waiting links, and clean up PR #574 follow-ups`

## Convention: `Fixes-release:`

A fix whose subject does not start with `fix` or `repair` is still attributed to the release it repairs by a line `Fixes-release: <version>` (for example `Fixes-release: 9.1.0`) in the commit body or in a changeset the commit adds. The version must be a released `immune-brain-v<version>` tag, and the commit must land within 7 days after that tag; otherwise it is not counted.

## Limits

- Only commits reachable from the checkout's HEAD are scanned.
- Issues are attributed by close time to the newest tag at or before it, not by the version a reporter named.
- With `gh` missing or failing the report omits the Issue column and says so instead of printing zero.
