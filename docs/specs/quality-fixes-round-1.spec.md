# Spec: Quality Fixes Round 1

**Date**: 2026-05-29
**Origin**: Project usage analysis — 10 improvement areas identified, top 3 actionable items selected.

## R1: Fix test_imm_init.py AttributeError

`tests/test_imm_init.py:52` references `self.module.AGENTS_SECTION_START`, but `init_project.py` exports the constant as `START` (not `AGENTS_SECTION_START`). The test `test_existing_claude_file_gets_one_bounded_section` always fails with `AttributeError`.

- **Expected**: `content.count(self.module.START)` — matches the actual export name.
- **Verification**: `python3 -m unittest tests.test_imm_init` passes all 2 tests.

## R2: Add missing `check-install` task to mise.toml

`README.md:154` references `mise run check-install`, but `mise.toml` does not define this task. Users following the README encounter a command-not-found error.

- **Expected**: `mise.toml` includes a `[tasks.check-install]` entry that checks skill installation status, consistent with the README description.
- **Verification**: `mise run check-install` exits zero.

## R3: Update IMMUNE.md to reflect workflow evolution

IMMUNE.md is at v1.0.0 (2026-05-05). Since then, the system added autowork checkpoint boundaries, parallel probes runtime, validate-only plan command, explicit `--sync` contract, gstack quality ceiling protocol, and host-bound evidence loops. None of these are reflected in the system constitution.

- **Expected**: IMMUNE.md updated to reflect current workflow state:
  - `imm-autowork` as deterministic checkpoint runtime (not LLM driver)
  - parallel probes runtime (`active → probing → executing` state extension)
  - validate-only plan command default with explicit `--sync` opt-in
  - gstack quality ceiling protocol as skill contract guidance (not runtime expansion)
  - host-bound evidence loops for planning subagents
- **Verification**: `python3 -m unittest tests.test_skill_contracts` passes; IMMUNE.md contains references to the new workflow terms.

## Non-goals

- PATH wrapper auto-fix mechanism (deferred to separate plan)
- `.imm/imm-heal.py` restructuring (architectural concern, needs deeper analysis)
- Artifact ratio governance (process concern, not code)
- Plugin version auto-sync mechanism (deferred)
