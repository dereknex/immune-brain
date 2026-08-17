---
name: imm-pr-fix
description: Use to repair PR review feedback and CI failures within the current PR scope; routes to code review and QA, not new planning.
---

# Immune-Brain: PR Fix

Load [`../../dist/imm-pr-fix.md`](../../dist/imm-pr-fix.md), run `imm-pr-diag` to collect
PR checks, review feedbacks, and merge conflicts, then repair solo or dispatch
parallel subagent repairs only when blocker categories are independent. Return
handled feedback, changed files, verification, push status, and Next Action.
