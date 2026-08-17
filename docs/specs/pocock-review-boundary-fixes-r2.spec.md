# Pocock Review Boundary Fixes Round 2

## Origin

Second code review of pocock-inspired improvements + first fix iteration found three remaining issues.

## Accepted Behaviors

### 1. Executor/QA advisory annotation wording
- Change executor and QA rules from "when the active step carries" to "when the active step's raw plan text contains" to clarify these annotations are read from plan markdown, not from runtime state.

### 2. Planner CONTEXT.md boundary
- Add CONTEXT.md to planner Boundary Allowed list alongside specs and plans.

### 3. Fast-track QA authority wording
- Reword fast-track to say imm-work routes through imm-qa closure semantics, not that it drives QA judgment itself.

## Out of Scope
- Adding Verification type / Prototype to imm-plan.py FIELD_RE (deferred)
