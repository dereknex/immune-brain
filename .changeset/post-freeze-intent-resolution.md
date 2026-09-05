---
"immune-brain": patch
---

Resolve the TaskIntent sidecar through the TaskRecord on the Claude Code Host.

`freeze_artifacts` relocates `docs/plans/<task-id>.intent.json` into
`docs/plans/archive/`, but the Claude adapter read every intent at the pre-freeze
default path. Any Managed task therefore failed QA settlement with a raw `ENOENT`
once its artifacts were frozen, which no test covered because every settled task
in this repository had run on Pi.

- `runtime/claude/kernel_ports.ts` now reads through `intent_ref.path` at all five
  call sites, matching the Pi adapter.
- `runtime/kernel/intent.ts` resolves a path-less read to the sidecar that exists —
  active first, archive as the post-freeze fallback — and reports a missing sidecar
  as a stable contract failure instead of a raw filesystem error.
- `runtime/assurance/coordinator.ts` proves a rejected ordinary mutation wrote
  nothing by re-reading the record revision, so a Kernel precondition rejection is
  reported as a deterministic failure rather than `settlement_unknown`, which the
  Loop would otherwise retry forever.
- `dist/imm-loop.md` carries the Initiative carrier gate it actually performs, so a
  failed `publish-initiative` batch can no longer be cleared by re-entering the Loop.
