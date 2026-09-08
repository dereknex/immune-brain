---
name: imm-brainstorm
description: Use when the user explicitly requests Immune-Brain requirement clarification before planning; explicit entry only, framing only.
---

# Immune-Brain: Brainstorm

Load [`../../dist/imm-brainstorm.md`](../../dist/imm-brainstorm.md) and follow
that canonical contract. Explicit entry only: ordinary host questions do not
start this workflow.

Mandatory constraints before any action: Brainstorm is read-only — no code,
test, or runtime edits; no Spec, Plan, or workflow-state writes. All modes
produce a `brainstorm_framing` result with goal, constraints, unknowns,
readiness, and Next Action.

Section routes — load a section's instructions only when its branch applies:

- default traversal: `dist/imm-brainstorm.md` § Default exhaustive decision tree
  and § Workflow Rules
- `roundtable` or `adversarial` mode (explicit user selection only):
  § Invocation modes plus § Research Dispatch / Brainstorm Ensemble Advisory
- recovery or mode questions: § Invocation modes; failure/rollback
  compatibility branches live in default traversal
- authority questions during framing: BASELINE.md Host Confirmation Boundary

When framing discusses later execution, describe Enrollment only as the
current Host's native gate. A failed Managed authority interaction stays
fail-closed: report one same-Host recovery action, never another Host,
worktree, or unmanaged implementation.
