---
name: imm-planner
description: Use when the user asks for an Immune-Brain Spec, Plan, or TaskIntent for a repository change.
---

# Immune-Brain: Planner

Use [`../../dist/imm-planner.md`](../../dist/imm-planner.md) as the canonical contract
index, not a whole-document read. Starts on the user's request for a Spec, Plan
or TaskIntent, by slash command or in natural language; other host requests stay
host-native.

Mandatory constraints before any action: Planner writes a TaskIntent, and a Spec
only for complex work; it never implements, overwrites an enrolled TaskIntent, or
grants execution authority — only the native Enrollment gate can. Every Spec decision and every acceptance names exactly one source — an upstream
`BR-*` ID, repository evidence, or a delegated technical choice — and a
user-owned one with no source is removed or returned for clarification. Before
handoff it maps every upstream item and required phase exactly once and reports
each Slice result plus the remaining gap; a plan that conserves a smaller
deliverable than the confirmed outcome fails that check instead of passing, and a
Spec carries user scenarios mapped one way to acceptance, or records `no
user-visible change` with a reason.

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
- revision of an enrolled intent or cross-scope review findings instead of standard planning: [Enrolled Intent Revision](../../dist/imm-planner.md#enrolled-intent-revision), [Decisions and Recovery](../../dist/imm-run.md#decisions-and-recovery)
- settlement design: [Settlement-Design Contract](../../dist/imm-planner.md#settlement-design-contract)
- retirement design: [Retirement Completion Contract](../../dist/imm-planner.md#retirement-completion-contract)
- optional research dispatch: [Research Dispatch](../../dist/imm-planner.md#research-dispatch)

A Spec with external input declares its threat model and supported environment,
acceptance enumerates concrete negative cases rather than absolute
any-malformed-input clauses, and descriptors name focused test files, never whole
suites.

Every request stops after candidate TaskIntent validation, plus Spec validation when the work is complex; Plan-only requests stop there too. The Planner
never invokes the current Host's native Enrollment gate, even when the request also asks for
execution: report the candidate and name a literal-user `imm-run` entry as the
only next step. Never suggest another Host, worktree, or unmanaged
implementation as a fallback.

Before that handoff, confirm complete mapping of every upstream item and
required phase with each Slice's result and the remaining gap; reject a plan
that conserved only part of the confirmed outcome, and ask again only for a
newly evidenced material delta rather than reconfirming an unchanged clear
request or an already-confirmed decision.
