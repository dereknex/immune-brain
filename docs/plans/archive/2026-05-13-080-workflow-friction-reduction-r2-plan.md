# Iteration Plan: Workflow Friction Reduction R2

## Task

- Summary: Implement the R2 workflow friction reduction improvements focusing on context efficiency via BASELINE.md, status output denoising, standardizing subagent delegation packets, and ensuring durable summary sync at closure.
- Origin: User analysis of the current workflow friction.
- Spec: `.imm/specs/workflow-friction-reduction-r2.spec.md`

## Research

- Previous specs identify key pain points.
- Core areas needing modification are the various skill markdown files under `skills/`, the `imm-work status` logic in `.imm/imm-work.py`, and the summary writing logic in `.imm/imm-finish.py` and `.imm/imm-compounder.py`.
- `skills/BASELINE.md` needs to be created or expanded.

## Decisions

- Context deduplication will be applied across all major authority roles by referencing the centralized `BASELINE.md`.
- `imm-work status` will default to a condensed string representation.
- Durable summary convergence will be strictly enforced during the completion lifecycle without altering `current_iteration.json`.

## Assumptions

- Tests in `tests/test_skill_contracts.py` will require updates to handle the terse skill definitions.
- The `imm-work` module has a clear point where output formatting is generated.

---

### Step 1

- Step ID: U1
- Result: Common workflow principles are extracted into skills/BASELINE.md which is referenced by imm-planner imm-work imm-executor imm-qa.
- Verification: `wc -c skills/imm-executor/SKILL.md` shows reduced file size; `python3 -m unittest tests/test_skill_contracts.py` passes with updated assertions.
- Depends on: None

### Step 2

- Step ID: U2
- Result: Subagent delegation payloads in imm-code-review are standardized using shared_context_summary focus_delta.
- Verification: `python3 -m unittest tests/test_skill_contracts.py` passes after modifying the delegation packet generation logic.
- Depends on: 1

### Step 3

- Step ID: U3
- Result: The imm-work status output in .imm/imm-work.py is refactored for a condensed high-signal summary.
- Verification: `imm-work status` output is less than 15 lines.
- Depends on: None

### Step 4

- Step ID: U4
- Result: Explicit durable summary sync logic is added in imm-finish imm-compounder.
- Verification: Running `imm-finish "Task summary" "Next steps"` updates the top section of MEMORY.md.
- Depends on: None