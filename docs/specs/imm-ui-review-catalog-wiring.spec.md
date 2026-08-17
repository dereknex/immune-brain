# Spec: imm-ui-review Catalog Wiring

**Task ID**: IMM-UIREV-CAT-001
**Owner**: Planner
**Status**: Draft

## 1. Goal
Extend the existing deterministic subagent activation catalog to support `imm-ui-review` as a dispatch host. This allows UI-related file changes to automatically and deterministically dispatch specialized advisory subagents (e.g., `a11y-reviewer`, `responsive-reviewer`, `visual-reviewer`) without needing a new runtime registry.

## 2. Context & Boundaries
- Inherits the host-bound, deterministic, and advisory-only constraints from `automatic-subagent-activation-policy.md`.
- `imm-ui-review` already has a dispatch protocol but currently lacks a trigger catalog (as noted in `subagent-remaining-work.md`).
- This does not introduce background scheduling, cross-agent communication, or automated code editing.

## 3. Requirements
### R1. Catalog Extension
- Update `docs/reference/subagent-trigger-catalog.yaml` to include an `imm-ui-review` host.
- Define initial children for the host (e.g., `a11y-reviewer`, `responsive-reviewer`, `visual-reviewer`) with concrete trigger surfaces (`path_globs`, `keywords`).
- Assign appropriate `model_tier` to each child (e.g., `fast` or `mid`).

### R2. Activation Plan Support
- Update `.imm/activation_plan.py` to recognize `imm-ui-review` as a valid host.
- Ensure the script correctly parses the new children and their rules to generate an activation plan when invoked for the `imm-ui-review` stage.

### R3. Policy Documentation
- Update `docs/reference/automatic-subagent-activation-policy.md` to document `imm-ui-review` as a supported host alongside `imm-code-review`.
- Document the allowed children for this new host.

### R4. Testing
- Add golden tests in `tests/test_activation_plan.py` for `imm-ui-review` triggers, including standalone `a11y-reviewer`, `responsive-reviewer`, and `visual-reviewer` trigger coverage plus multi-trigger and no-trigger fallback coverage.

## 4. Acceptance Criteria
- `docs/reference/subagent-trigger-catalog.yaml` includes the `imm-ui-review` host and its children.
- `.imm/activation_plan.py` can generate plans for `imm-ui-review` based on file changes.
- Golden tests pass for the new host logic.
- Policy documentation is updated.
- Review follow-up coverage proves standalone responsive and visual UI trigger behavior.
