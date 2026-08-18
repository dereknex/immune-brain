---
status: superseded
superseded_by: docs/adr/0003-internal-role-prompt-routing.md
retired_at: 2026-08-18
reason: Architecture exploration is now an internal role dispatch selected by Brainstorm or Planner; public user-facing entry surfaces are being reduced to the three canonical Skills.
---

# Dedicated Architecture Explorer Skill

This historical decision is superseded by [ADR 0003](0003-internal-role-prompt-routing.md).
Architecture exploration is now an internal read-only role selected by
`imm-brainstorm` or `imm-planner`; it is not a public Skill. The original
standalone entry point is retained here only as historical context.
