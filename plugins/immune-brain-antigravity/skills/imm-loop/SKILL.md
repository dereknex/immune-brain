---
name: imm-loop
description: Use when the user explicitly requests starting, stopping, inspecting, or managing the Immune-Brain Loop daemon.
---

# Immune-Brain: Loop Daemon

Use [`../../dist/imm-loop.md`](../../dist/imm-loop.md) as the canonical contract
index, not a whole-document read. This is a standalone daemon-control entry for
the repository's background Loop daemon (ADR 0039), not an in-session `drive`
Run binding and not a `drive` internal-role dispatch.

Mandatory constraints: resolve `../../bin/imm-loop` and `../../bin/imm-kernel`
from this Skill's location rather than assuming `PATH`. Run commands from the
target repository root, inspect `loop.mode` before live startup, and treat PR
merge as human-only.

Section routes - load a section's instructions only when its branch applies.
Read each linked heading body up to the next heading; nested sections and
references load only under their own condition. Never read the whole contract
or all references as an entry prerequisite.

- common: [Shared Guards](../../dist/BASELINE.md#shared-guards), [Workflow Activation](../../dist/BASELINE.md#workflow-activation), [Host Confirmation Boundary](../../dist/BASELINE.md#host-confirmation-boundary), [Authority Boundary](../../dist/imm-loop.md#authority-boundary)
- status, logs, or dry-run observation: [1. Resolve wrappers](../../dist/imm-loop.md#1-resolve-wrappers), [2. Inspect and observe](../../dist/imm-loop.md#2-inspect-and-observe)
- starting the background daemon: [1. Resolve wrappers](../../dist/imm-loop.md#1-resolve-wrappers), [3. Preflight and start](../../dist/imm-loop.md#3-preflight-and-start)
- stopping, pausing, resuming, or retiring a lease: [1. Resolve wrappers](../../dist/imm-loop.md#1-resolve-wrappers), [4. Control and recovery](../../dist/imm-loop.md#4-control-and-recovery), [Output](../../dist/imm-loop.md#output)
