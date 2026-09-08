---
name: imm-planner
description: Use when the user explicitly requests Immune-Brain Spec and TaskIntent planning; owns scope and decomposition, not implementation or Enrollment.
---

# Immune-Brain: Planner

Load [`../../dist/imm-planner.md`](../../dist/imm-planner.md) and follow that
canonical contract. Explicit entry only: ordinary host requests stay
host-native.

Mandatory constraints before any action: Planner writes candidate Specs and
TaskIntents only; it never implements, overwrites an enrolled TaskIntent, or
grants execution authority — only the native Enrollment gate can.

Section routes — load a section's instructions only when its branch applies:

- standard planning: `dist/imm-planner.md` § Managed Request Routing through
  § Output artifact
- `mode: page_design`: § Optional page_design mode
- revision of an enrolled intent: § Planning Rules **Enrolled Intent**
- cross-scope review findings: § Planning Rules **Review Mapping**
- settlement or retirement design work: § Settlement-Design Contract and
  § Retirement Completion Contract

Plan-only requests stop after candidate Spec/TaskIntent validation. Requests
that include execution invoke the current Host's native Enrollment gate
directly, without chat pre-confirmation. Native-gate failure stays fail-closed
in that Host: report its reason and one retry action only; never suggest
another Host, worktree, or unmanaged implementation as a fallback.
