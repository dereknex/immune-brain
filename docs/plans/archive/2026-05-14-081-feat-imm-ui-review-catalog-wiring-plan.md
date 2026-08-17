# Iteration Plan: imm-ui-review Catalog Wiring

## Task

- Summary: Extend the subagent trigger catalog to support imm-ui-review. Updates the YAML catalog, Python activation logic, policy documentation, and test suite to enable deterministic dispatch of UI-specific reviewers based on file changes.
- Origin: Brainstorm session identifying `imm-ui-review` catalog wiring as a key remaining subagent task.
- Spec: `.imm/specs/imm-ui-review-catalog-wiring.spec.md`

## Research
- `subagent-remaining-work.md` identifies `imm-ui-review catalog 接线` as "未开始" and "按需规划".
- `subagent-trigger-catalog.yaml` currently only supports `imm-code-review`.
- `.imm/activation_plan.py` handles the logic and needs updating for the new host and its specific fallback reasons/constraints.
- Tests in `tests/test_activation_plan.py` exist for `imm-code-review` and can be used as a template.
- Origin review: `imm-code-review` found that policy requires standalone UI responsive-layout and visual-polish trigger golden tests while the existing new tests only prove a11y standalone plus a broad component-path multi-trigger case.

## Decisions
- Add `imm-ui-review` to the YAML catalog with children: `a11y-reviewer`, `responsive-reviewer`, and `visual-reviewer`.
- Keep the system deterministic and host-bound; no LLM routing.
- Keep child reviewers `advisory_only`.

## Assumptions
- `imm-ui-review` dispatch protocol is already capable of taking an activation plan (as it shares the protocol with `imm-code-review`).
- The Python script structure easily accommodates a new host block.

---

### Step 1

- Step ID: U1
- Result: The imm-ui-review host with its children is added to docs/reference/subagent-trigger-catalog.yaml.
- Verification: `cat docs/reference/subagent-trigger-catalog.yaml | grep imm-ui-review`
- Depends on: None

### Step 2

- Step ID: U2
- Result: .imm/activation_plan.py is updated to output activation plans for the imm-ui-review stage.
- Verification: `python3 .imm/activation_plan.py --validate-refs`
- Depends on: 1

### Step 3

- Step ID: U3
- Result: tests/test_activation_plan.py includes tests for imm-ui-review trigger scenarios.
- Verification: `python3 -m unittest tests.test_activation_plan`
- Depends on: 2

### Step 4

- Step ID: U4
- Result: The automatic-subagent-activation-policy.md file along with subagent-remaining-work.md are updated to reflect the new capabilities.
- Verification: `cat docs/reference/automatic-subagent-activation-policy.md | grep imm-ui-review`
- Depends on: 2

### Step 5

- Step ID: U5
- Result: tests/test_activation_plan.py covers standalone responsive-reviewer plus visual-reviewer imm-ui-review triggers.
- Verification: `python3 -m unittest tests.test_activation_plan`
- Depends on: 3
