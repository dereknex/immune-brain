# Spec: Architecture Deepening Wave 1

## Objective
Formalize the internal codebase structure of Immune-Brain engine to improve maintainability, decouple project data from engine logic, and enforce runtime boundaries.

## Requirements
1. **Internal Package Migration**: 
   - Create `.imm/imm_core/` as a proper Python package (`__init__.py`).
   - Move `state_machine.py` and `current_iteration_state.py` into it.
   - Refactor `importlib.util` dynamic loads in all `imm-*.py` scripts to use standard Python imports.
2. **State Ledger Centralization**:
   - Create `LedgerManager` inside `imm_core` to encapsulate all `current_iteration.json` reads, writes, and schema migrations.
3. **Workspace Data Hygiene**:
   - Move the directory `.imm/specs/` to `docs/specs/`.
   - Update `imm-plan.py` and any related scripts/tests to use the new path for resolving specs.
4. **Skill Runtime Boundary**:
   - Introduce `SkillRuntime` to read `registry.yaml`.
   - Ensure role constraints (boundaries) are recorded or logged during workflow activation.
