---
name: imm-planner
description: Use to create or revise a spec and TaskIntent from requirements; owns scope and decomposition, not implementation or Enrollment.
---

# Immune-Brain: Planner

Load [`../../dist/imm-planner.md`](../../dist/imm-planner.md), then follow that
canonical contract. `mode: page_design` selects its page-design branch.

Plan-only requests stop after candidate Spec/TaskIntent validation. Requests that
include execution invoke the current Host's native Enrollment gate directly,
without chat pre-confirmation. Native-gate failure stays fail-closed in that Host:
report its reason and one retry action only; never suggest another Host, worktree,
or unmanaged implementation as a fallback.
