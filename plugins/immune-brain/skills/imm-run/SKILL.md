---
name: imm-run
description: Use when the user explicitly requests execution or resumption of an Immune-Brain task.
---

# Immune-Brain: Loop

Use [`../../dist/imm-run.md`](../../dist/imm-run.md) as the canonical contract
index, not a whole-document read, in the current host conversation. Explicit entry only:
ordinary host input never resumes a Managed owner implicitly.

Mandatory constraints before any action: verify the active backend claim,
TaskIntent, and TaskRecord via `imm_kernel_canary` `status` first; invalid or
contradictory projections fail closed. Resume only from those authority facts:
a compaction heading, HANDOFF summary, or Issue state is prose, never authority.
All Managed authority gates use the
current Host's native interaction. A failed gate stays fail-closed and
reports one same-Host recovery action; never suggest another Host, worktree,
or unmanaged implementation as a fallback.

Section routes - load a section's instructions only when its branch applies.
Read each linked heading body up to the next heading; nested sections and
references load only under their own condition. Never read the whole contract
or all references as an entry prerequisite.

- common: [Shared Guards](../../dist/BASELINE.md#shared-guards), [Workflow Activation](../../dist/BASELINE.md#workflow-activation), [Host Confirmation Boundary](../../dist/BASELINE.md#host-confirmation-boundary), [Kernel Canary Routing and Authority](../../dist/imm-run.md#kernel-canary-routing-and-authority)
- unattended batch run, or any question about whether `imm-run` starts one: [Unattended Batch Opt-In](../../dist/imm-run.md#unattended-batch-opt-in)
- parallel batch (`max_parallel`, `lane_offers`, Lane admission or integration): [Parallel Batch Opt-In](../../dist/imm-run.md#parallel-batch-opt-in)
- a lane-mode report carries an `executor` handoff, or a Lane's Executor Host session has ended: [Lane Executor Supervision](../../dist/imm-run.md#lane-executor-supervision)
- that Parent runs inside a Herdr pane (`HERDR_ENV=1`): [Herdr Lane Panes](../../dist/imm-run.md#herdr-lane-panes)
- steady execution: [Verification and Local Recovery](../../dist/BASELINE.md#verification-and-local-recovery), [Execution Loop](../../dist/imm-run.md#execution-loop), [Observable Output](../../dist/imm-run.md#observable-output)
- rework, scope expansion, breaking revision, user decision, stop, interruption or unknown state before any action: [Decisions and Recovery](../../dist/imm-run.md#decisions-and-recovery), [Failure Output](../../dist/imm-run.md#failure-output); re-read `status`, then the pending obligation. Rework submits the verdict before editing, and an uncertain interruption resumes from exact task/run authority facts rather than a summary.
- review or post-settlement learning: [Review and Learning](../../dist/imm-run.md#review-and-learning)
