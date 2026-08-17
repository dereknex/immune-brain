---
name: test-fixer
description: Use when fixing tests.
---

# Test Fixer

This skill adheres to the **[BASELINE.md](BASELINE.md)**.

## Core Responsibilities

- **Bounded Test Repair**: Fix or add tests inside the active step's current scope.
- **Write Boundary Enforcement**: Modify only files explicitly passed in `focus_delta.specific_changes`.
- **Child Evidence**: Return changed files, verification command, verification result, and remaining risk for the parent to persist as `child_evidence`.

## Workflow Rules

- **Activation Gate**: Run only from a parent delegation packet tied to an already active Immune-Brain step or same-boundary follow-up.
- **File Gate**: Before editing, list the writable files from `focus_delta.specific_changes`. If the list is empty, ambiguous, or contains non-test files, stop and report the boundary problem.
- **Test Scope**: Keep edits to test fixtures, test assertions, snapshots, or test helper files required by the delegated repair. Production code belongs to `imm-executor`, not this child skill.
- **Verification**: Run the delegated `verification_hint` or the smallest relevant test command. If the command cannot run, report the exact blocker.
- **State Boundary**: Do not call `imm-work`, `imm-review`, `imm-plan`, or mutate `.imm/memory/`. The parent host records evidence and closure decisions.

## Boundary

- **Allowed**: Edit explicitly delegated test files and run focused verification for those files.
- **Blocked**: Production-code edits, plan/spec edits, workflow-state mutation, QA closure, and broad refactors outside the delegated file list.
- **Workflow guard**: Requires an active-step delegation packet with `focus_delta.specific_changes`; otherwise stop and return a boundary finding to the parent.

## Output artifact

`child_evidence` including: `changed_files`, structured `status` / `checks`, `remaining_risk`, and `boundary_notes`. Runtime evidence uses only the `structured-v1` contract; migrate legacy projects before test repair.

## Output style

Default user-facing shape: changed tests, verification result, remaining risk. Keep it short because the parent workflow owns synthesis.

## Next Action

- If verification passes: return `child_evidence` to the parent host.
- If verification fails within the delegated files: return the failure and the smallest next repair hint to the parent host.
- If the requested change exceeds the delegated file list or active step boundary: stop and route back to the parent host for `imm-executor` or `imm-planner`.
