---
name: imm-planner
description: Use when the user explicitly requests Immune-Brain Spec and TaskIntent planning.
---

# Immune-Brain: Planner

Use [`../../dist/imm-planner.md`](../../dist/imm-planner.md) as the canonical contract
index, not a whole-document read. Explicit entry only: ordinary host requests stay
host-native.

Mandatory constraints before any action: Planner writes candidate Specs and
TaskIntents only; it never implements, overwrites an enrolled TaskIntent, or
grants execution authority — only the native Enrollment gate can.

Section routes - load a section's instructions only when its branch applies.
Read each linked heading body up to the next heading; nested sections and
references load only under their own condition. Never read the whole contract
or all references as an entry prerequisite.

Standard planning advances in order: assess the request, prepare candidates,
validate candidates, then hand off. Load each stage only when reached; later
stages retain earlier constraints. Page design and enrolled revision use their
own routes instead of these stages.

- common: [Shared Guards](../../dist/BASELINE.md#shared-guards), [Workflow Activation](../../dist/BASELINE.md#workflow-activation), [Host Confirmation Boundary](../../dist/BASELINE.md#host-confirmation-boundary), [Boundary](../../dist/imm-planner.md#boundary)
- assess request: [Managed Request Routing](../../dist/imm-planner.md#managed-request-routing), [Clarification supplement](../../dist/imm-planner.md#clarification-supplement), [Kernel TaskIntent Routing](../../dist/imm-planner.md#kernel-taskintent-routing), [Planning Rules](../../dist/imm-planner.md#planning-rules)
- prepare candidates before authoring: [Candidate Authoring](../../dist/imm-planner.md#candidate-authoring), [Verification Descriptor Discipline](../../dist/imm-planner.md#verification-descriptor-discipline), [Core Responsibilities](../../dist/imm-planner.md#core-responsibilities), [Output artifact](../../dist/imm-planner.md#output-artifact), [Verification and Local Recovery](../../dist/BASELINE.md#verification-and-local-recovery)
- validate candidates: [Verification](../../dist/imm-planner.md#verification)
- handoff after validation: [Output style](../../dist/imm-planner.md#output-style), [Next Action](../../dist/imm-planner.md#next-action)
- `mode: page_design` instead of standard planning: [Optional page_design mode](../../dist/imm-planner.md#optional-page_design-mode)
- multiple-TaskIntent Initiative before carrier selection or publication: [Initiative Carrier Preference](../../dist/imm-planner.md#initiative-carrier-preference)
- revision of an enrolled intent or cross-scope review findings instead of standard planning: [Enrolled Intent Revision](../../dist/imm-planner.md#enrolled-intent-revision), [Decisions and Recovery](../../dist/imm-loop.md#decisions-and-recovery)
- settlement design: [Settlement-Design Contract](../../dist/imm-planner.md#settlement-design-contract)
- retirement design: [Retirement Completion Contract](../../dist/imm-planner.md#retirement-completion-contract)
- optional research dispatch: [Research Dispatch](../../dist/imm-planner.md#research-dispatch)

Plan-only requests stop after candidate Spec/TaskIntent validation. Requests
that include execution invoke the current Host's native Enrollment gate
directly, without chat pre-confirmation. Native-gate failure stays fail-closed
in that Host: report its reason and one retry action only; never suggest
another Host, worktree, or unmanaged implementation as a fallback.
