- Summary: Formalize Immune-Brain internal structure by centralizing state ledger authority and migrating specs to docs while enforcing skill boundaries.
- Origin: Architecture Exploration

## Task
- Spec: docs/specs/architecture-deepening-wave-1.spec.md

## Steps

### Step 1
- Result: Engine scripts are refactored to use standard imports from a new .imm/imm_core/ Python package containing the state modules.
- Verification: pytest tests/
- Step ID: U1
- Depends on: None

### Step 2
- Result: State transition logic is fully encapsulated within a new LedgerManager service in imm_core.
- Verification: pytest tests/test_state_ledger.py
- Step ID: U2
- Depends on: 1

### Step 3
- Result: Specs are relocated to docs/specs/ with imm-plan.py updated to resolve the new path.
- Verification: pytest tests/test_imm_plan.py
- Step ID: U3
- Depends on: None

### Step 4
- Result: SkillRuntime validator enforces role constraints from registry.yaml during step activation.
- Verification: pytest tests/test_skill_contracts.py
- Step ID: U4
- Depends on: 1
