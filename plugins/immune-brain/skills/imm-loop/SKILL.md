---
name: imm-loop
description: Use when the user explicitly requests execution or resumption of an Immune-Brain task.
---

# Immune-Brain: Loop

Use [`../../dist/imm-loop.md`](../../dist/imm-loop.md) as the canonical contract
index, not a whole-document read, in the current host conversation. Explicit entry only:
ordinary host input never resumes a Managed owner implicitly.

Mandatory constraints before any action: verify the active backend claim,
TaskIntent, and TaskRecord via `imm_kernel_canary` `status` first; invalid or
contradictory projections fail closed. All Managed authority gates use the
current Host's native interaction. A failed gate stays fail-closed and
reports one same-Host recovery action; never suggest another Host, worktree,
or unmanaged implementation as a fallback.

Section routes - load a section's instructions only when its branch applies.
Read each linked heading body up to the next heading; nested sections and
references load only under their own condition. Never read the whole contract
or all references as an entry prerequisite.

- common: [Shared Guards](../../dist/BASELINE.md#shared-guards), [Workflow Activation](../../dist/BASELINE.md#workflow-activation), [Host Confirmation Boundary](../../dist/BASELINE.md#host-confirmation-boundary), [Kernel Canary Routing and Authority](../../dist/imm-loop.md#kernel-canary-routing-and-authority)
- unattended batch run, or any question about whether `imm-loop` starts one: [Unattended Batch Opt-In](../../dist/imm-loop.md#unattended-batch-opt-in)
- steady execution: [Verification and Local Recovery](../../dist/BASELINE.md#verification-and-local-recovery), [Execution Loop](../../dist/imm-loop.md#execution-loop), [Observable Output](../../dist/imm-loop.md#observable-output)
- rework, scope expansion, breaking revision, user decision, stop, interruption or unknown state before any action: [Decisions and Recovery](../../dist/imm-loop.md#decisions-and-recovery), [Failure Output](../../dist/imm-loop.md#failure-output); re-read `status`, then the pending obligation
- review or post-settlement learning: [Review and Learning](../../dist/imm-loop.md#review-and-learning)
