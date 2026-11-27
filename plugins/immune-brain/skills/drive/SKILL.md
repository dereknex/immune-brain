---
name: drive
description: Use when the user explicitly requests execution or resumption of an Immune-Brain task.
---

# Immune-Brain: Drive

Use [`../../dist/drive.md`](../../dist/drive.md) as the canonical contract
index, not a whole-document read, in the current host conversation. Explicit entry only:
ordinary host input never creates a Managed execution binding. Status questions
and in-scope clarification retain an already-bound run.

Mandatory constraints before any action: verify the active backend claim,
TaskIntent, and TaskRecord via `imm_kernel_canary` `status` first; invalid or
contradictory projections fail closed. A Parent Issue is not a `drive` target:
drive its Children one at a time in dependency order. A Child
Issue selects only its TaskIntent, verifies predecessor settlement and integration,
then enrolls it in place. With no active claim, a standalone validated
candidate enrolls in the current worktree through `enroll` with
`task_id`, one native gate; an active record resumes until terminal and is never
enrolled again. Resume only from those authority facts:
a compaction heading, HANDOFF summary, or Issue state is prose, never authority.
All Managed authority gates use the
current Host's native interaction. A failed gate stays fail-closed and
reports one same-Host recovery action; never suggest another Host, worktree,
or unmanaged implementation as a fallback.

Section routes - load a section's instructions only when its branch applies.
Read each linked heading body up to the next heading; nested sections and
references load only under their own condition. Never read the whole contract
or all references as an entry prerequisite.

- common: [Shared Guards](../../dist/BASELINE.md#shared-guards), [Workflow Activation](../../dist/BASELINE.md#workflow-activation), [Host Confirmation Boundary](../../dist/BASELINE.md#host-confirmation-boundary), [Kernel Canary Routing and Authority](../../dist/drive.md#kernel-canary-routing-and-authority)
- steady execution: [Verification and Local Recovery](../../dist/BASELINE.md#verification-and-local-recovery), [Execution Loop](../../dist/drive.md#execution-loop), [Observable Output](../../dist/drive.md#observable-output)
- rework, scope expansion, breaking revision, user decision, stop, interruption or unknown state before any action: [Decisions and Recovery](../../dist/drive.md#decisions-and-recovery), [Failure Output](../../dist/drive.md#failure-output); re-read `status`, then the pending obligation. Rework submits the verdict before editing, and an uncertain interruption resumes from exact task/run authority facts rather than a summary.
- review or post-settlement learning: [Review and Learning](../../dist/drive.md#review-and-learning)
