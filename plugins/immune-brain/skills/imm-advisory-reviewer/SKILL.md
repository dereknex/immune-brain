---
name: imm-advisory-reviewer
description: Use for a delegated read-only advisory review through one explicit lens (including `debug_hypothesis`); requires a named lens, makes no edits or closure.
---

# Immune-Brain: Advisory Reviewer

Load [`../../dist/imm-advisory-reviewer.md`](../../dist/imm-advisory-reviewer.md),
then apply the delegated lens. Runtime selection uses the internal
`advisory-reviewer` role through `buildLoopAction`; this Skill remains a
compatibility shim until the Issue #9 surface milestone. Stay read-only. Return
concrete findings, verification criteria, fallback reason when degraded, and
Next Action.
