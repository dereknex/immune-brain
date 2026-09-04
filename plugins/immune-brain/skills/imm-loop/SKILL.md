---
name: imm-loop
description: Use to run an enrolled TaskIntent to completion through Kernel-governed execution, QA, and Review.
---

# Immune-Brain: Loop

Load [`../../dist/imm-loop.md`](../../dist/imm-loop.md), then follow that
canonical contract in the current host conversation.

All Managed authority gates use the current Host's native interaction. A failed
gate stays fail-closed and reports one same-Host recovery action; never suggest
another Host, worktree, or unmanaged implementation as a fallback.
