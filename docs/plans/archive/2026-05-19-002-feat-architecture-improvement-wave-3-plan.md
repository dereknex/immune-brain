## Task
- Summary: Eliminate 5 architecture debts by shimming imm-plan.py to plan_runtime then splitting iteration state responsibilities then wiring arbitration into synthesis then adding pyproject.toml then detecting stale doc references.
- Origin: architecture-exploration (imm-arch-explorer)
- Research:
  - `imm-plan.py` (742 lines) duplicates `STEP_HEADER_RE` / `STEP_ID_RE` / `MULTI_RESULT_MARKERS` with `plan_runtime.py` (739 lines). The `activation_plan.py` shim pattern is the proven reference.
  - `current_iteration_state.py` (744 lines) mixes LedgerManager + v1-to-v2 migration + heal recovery + dehydration + legacy path IO across 4 unrelated responsibilities.
  - `review_arbitration.py` (104 lines) lives in `.imm/` root with tests but is never imported by `code_review_subagents.build_code_review_synthesis_from_outcomes`.
  - 13 files use `sys.path.insert` to find `imm_core`; no `pyproject.toml` exists under `.imm/`.
  - `imm-compound-debt.py` (374 lines) does learning-debt analysis but has no cross-reference staleness check across the 373 docs.
- Decisions:
  - D1: S1 first (smallest blast radius establishes the shim pattern).
  - D2: S2 after S1 (clean import structure helps extraction).
  - D3: S3 independent of S1/S2 (arbitration wiring has no structural dependency).
  - D4: A1 after S1/S2 (fewer fat CLIs when adding pyproject.toml).
  - D5: A2 fully independent (placed last to keep focus).
  - D6: Move `review_arbitration.py` into `imm_core/` following the Internal Package Migration pattern from `docs/solutions/architecture.md`.
- Assumptions:
  - `activation_plan.py` shim pattern directly applicable to `imm-plan.py`.
  - heal / migration / dehydration functions have unidirectional dependency on LedgerManager (no cycles).
  - Minimal `pyproject.toml` with `[project]` metadata suffices; no build system needed.

## Steps

### Step 1
- Step ID: U001
- Result: `imm-plan.py` reduced to a thin CLI shim delegating all parsing/validation/signature logic to `imm_core.plan_runtime` with no duplicated regex constants
- Verification: `python3 -m unittest discover -s tests`
- Discovery cache: .imm/imm-plan.py (duplication source CLI entry point); .imm/imm_core/plan_runtime.py (target validation engine); .imm/activation_plan.py (shim pattern reference); tests/test_imm_plan.py (regression coverage)

### Step 2
- Step ID: U002
- Result: `current_iteration_state.py` contains only LedgerManager with heal/migration/dehydration extracted into dedicated modules under imm_core
- Verification: `python3 -m unittest discover -s tests`
- Discovery cache: .imm/imm_core/current_iteration_state.py (extraction target); .imm/imm_core/state_machine.py (state machine dependency); tests/test_current_iteration_state.py (regression coverage); tests/test_state_ledger.py (state ledger tests)

### Step 3
- Step ID: U003
- Result: `build_code_review_synthesis_from_outcomes` uses `imm_core.review_arbitration` for priority-ordered conflict-grouped synthesis instead of plain concatenation
- Verification: `python3 -m unittest discover -s tests`
- Discovery cache: .imm/review_arbitration.py (module to relocate into imm_core); .imm/imm_core/code_review_subagents.py (synthesis integration point); tests/test_imm_review.py (arbitration tests); docs/specs/archive/subagent-telemetry-arbitration-integration.spec.md (requirement source)

### Step 4
- Step ID: U004
- Result: `.imm/pyproject.toml` enables editable install of imm_core with all test-file sys.path.insert hacks removed
- Verification: `pip install -e .imm/ && python3 -m unittest discover -s tests`
- Discovery cache: .imm/imm_core/__init__.py (package entry); tests/test_imm_plan.py (sys.path hack example); tests/test_current_iteration_state.py (sys.path hack example); scripts/legacy-installer.sh (immutable install script)

### Step 5
- Step ID: U005
- Result: A stale-reference detection script reports broken skill references plus dead spec/plan links across all docs without false positives on valid references
- Verification: `python3 scripts/detect-stale-refs.py docs/`
- Discovery cache: .imm/imm-compound-debt.py (extension candidate); skills/registry.yaml (valid skill roster); docs/specs/ (cross-reference source); docs/plans/ (cross-reference source)
