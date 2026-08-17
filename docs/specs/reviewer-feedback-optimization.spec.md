# Reviewer Feedback Optimization Spec

## Goal
Reduce the number of code review rounds by moving away from rigid patch-based feedback to a test-driven `verification_criteria` model, enforcing pre-checks, and tightly bounding the Executor's scope during rework loops.

## Requirements

- Update `imm-code-review` orchestrator and the reviewer subagent contracts to require `verification_criteria` (e.g., expected inputs/outputs, failing test scenario) instead of exact patches.
- Introduce a pre-check QA step for the Executor: before moving a step to `ready_for_review`, the Executor must ensure local tests/baselines pass.
- Restrict the Executor's scope during rework: they must focus solely on satisfying the reviewer's `verification_criteria` and refrain from unrelated refactoring.
- Retain the `no tools` and `advisory-only` boundaries for all sub-reviewers.