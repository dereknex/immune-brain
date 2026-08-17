---
name: imm-executor
description: Use to implement exactly one activated plan step's edits and record execution evidence; no plan changes, no QA closure, no scope expansion.
---

# Immune-Brain: Executor

Load [`../../dist/imm-executor.md`](../../dist/imm-executor.md), then implement only
the active planned step. Apply the YAGNI Red-Line Gate before handoff, verify
the step, and record evidence through `imm-work`. In Standard Plans the runtime
closes a Step from passing evidence; this does not grant Executor QA authority.
Strict Steps and every reviewer follow-up still route to independent QA. Return changed files,
verification, and Next Action.
