---
name: imm-loop
description: Use when the user explicitly requests execution or resumption of an Immune-Brain managed task through the Kernel-governed loop.
---

# Immune-Brain: Loop

Load [`../../dist/imm-loop.md`](../../dist/imm-loop.md) and follow that
canonical contract in the current host conversation. Explicit entry only:
ordinary host input never resumes a Managed owner implicitly.

Mandatory constraints before any action: verify the active backend claim,
TaskIntent, and TaskRecord via `imm_kernel_canary` `status` first; invalid or
contradictory projections fail closed. All Managed authority gates use the
current Host's native interaction. A failed gate stays fail-closed and
reports one same-Host recovery action; never suggest another Host, worktree,
or unmanaged implementation as a fallback.

Section routes — load a section's instructions only when its branch applies:

- steady execution: `dist/imm-loop.md` § Execution Loop
- rework or findings: § Execution Loop step 6 plus § Decisions and Recovery
- scope expansion: § Decisions and Recovery (route to `imm-planner`)
- breaking intent revision: § Decisions and Recovery (native gate)
- interruption or unknown state: re-read `status`, then the pending obligation
