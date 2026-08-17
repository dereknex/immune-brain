# Spec: L2S-WF (Lightweight 2-Step Workflow) Pattern

## 1. Objective

Codify a lightweight two-step Immune-Brain workflow that preserves authority
separation without maintaining duplicate Skill aliases.

## 2. Canonical Skills

### Step 1: `/imm-planner` (The "What" and "How")

- **Role**: Planning authority.
- **Workflow**: brief clarification when possible; `imm-brainstorm` first when material ambiguity remains.
- **Accepted behaviors**:
  - Produce a behavioral Spec in `docs/specs/`.
  - Produce a validated Plan in `docs/plans/`.
  - Make no implementation edits.
- **Exit criteria**: A validated Plan exists.

### Step 2: `/imm-loop` (The "Do" and "Check")

- **Role**: Completion-loop coordinator.
- **Workflow**: `imm-autowork` checkpoints -> execution -> isolated QA/review -> `imm-compounder` handoff.
- **Accepted behaviors**:
  - Execute active Steps within declared scope.
  - Record evidence before QA closure.
  - Run required review gates after material changes.
  - Return same-boundary review follow-up through `imm-work`.
  - Report the learning handoff after successful Plan closure.
- **Exit criteria**: The Plan closes or the loop stops at an explicit safety boundary.

## 3. Constraints

- **State integrity**: Both Skills preserve `.imm/memory/current_iteration.json` continuity.
- **No skipping**: `/imm-loop` requires a validated Plan from `/imm-planner`.
- **Surgicality**: Execution only touches files declared by the active Step.
- **No shell alias**: This pattern uses canonical Codex Skills.

## 4. Verification Scenarios

- Scenario A: A clear request enters `/imm-planner` and produces a validated Plan.
- Scenario B: A materially ambiguous request routes through `/imm-brainstorm` before planning.
- Scenario C: `/imm-loop` executes a valid Plan and reports the `imm-compounder` handoff.
- Scenario D: A replan decision returns to `/imm-planner`.
