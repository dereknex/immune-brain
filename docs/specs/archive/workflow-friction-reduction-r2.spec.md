# Spec: Workflow Friction Reduction R2

**Task ID**: IMM-WORKFLOW-080
**Owner**: Planner
**Status**: Proposed

## 1. Goal
To address the operational friction in the Immune-Brain workflow, standardizing subagent delegation, reducing verbose output in standard paths, enforcing correct `imm-code-review` follow-up semantics, and ensuring durable summary convergence on completion without compromising the strict authority boundaries.

## 2. Functional Requirements
- **Context Efficiency**:
  - Extract universally applicable workflow rules ("Think before coding", "Surgical changes", etc.) from individual skill documents into a central `skills/BASELINE.md` to reduce prompt token sizes.
  - Implement a structured subagent delegation packet format (`shared_context_summary` + `focus_delta`) across all review-oriented skills to optimize context distribution.
- **Output Denoising**:
  - Refactor `imm-work status` to output only a terse, high-signal summary (Active Plan, Active Step, Latest Review, Next Action) by default, obscuring long iteration history behind a `--json` or `--verbose` flag.
  - Suppress extraneous build and test trace output from execution evidence logs during `imm-qa` success paths to enhance reviewability.
- **Routing and Closure Consistency**:
  - Reinforce the contract in `imm-code-review` to strictly distinguish inline repair (`same_boundary_candidate`) from structural follow-ups (`new_slice`), forcing explicit routing clarity for subsequent plans.
  - Automate the realignment of the durable summary (`MEMORY.md`) to the `completed` state when closing a plan via `imm-finish` or `imm-compounder`, removing the lagging "execution in progress" text.

## 3. Acceptance Criteria
- [ ] `skills/BASELINE.md` holds the consolidated workflow norms, and individual skills reference it.
- [ ] Delegation payloads for reviewer subagents strictly utilize the standardized packet format.
- [ ] `imm-work status` output visually emphasizes the current execution state without dumping `current_iteration.json`.
- [ ] Execution evidence output is verifiably quieter in success paths.
- [ ] `imm-code-review` contract explicitly defines `repairability` rules.
- [ ] Completing a plan triggers a successful and accurate `MEMORY.md` sync.

## 4. Constraints
- The `imm-executor`, `imm-qa`, and `imm-work` capability separation MUST remain intact.
- Do NOT rewrite the underlying `current_iteration.json` state machine logic.
- Do NOT merge authority roles.