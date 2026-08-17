# Plan: Discovery Navigation Layer Implementation

- Summary: Implement a three-tier discovery system (static, dynamic, and pattern-based) to optimize agent file retrieval and reduce search overhead.

## Task
- Brainstorm manifest: BR-REQ-005, BR-REQ-006, BR-REQ-007, BR-REQ-008, BR-REQ-009, BR-DEC-004, BR-DEC-005, BR-DEC-006, BR-DEC-007

## Brainstorm Trace
| Item | Status | Target | Reason |
| --- | --- | --- | --- |
| BR-REQ-005 | covered_by_step | U102 | CONTEXT.md Architecture Map |
| BR-REQ-006 | covered_by_step | U101 | current_iteration.json discovery_cache |
| BR-REQ-007 | covered_by_step | U103 | docs/solutions/ key_files |
| BR-REQ-008 | covered_by_step | U103 | imm-compounder backfill |
| BR-REQ-009 | covered_by_step | U101 | discovery_cache reason field |
| BR-DEC-004 | covered_by_step | U102 | Lightweight CLAUDE.md/AGENTS.md |
| BR-DEC-005 | covered_by_step | U102 | imm-init as primary bootstrapper |
| BR-DEC-006 | covered_by_step | U104 | Three-tier discovery protocol in skills |
| BR-DEC-007 | covered_by_step | U102 | imm-init pre-populates system files |

## Steps

### Step 1
- Result: Discovery cache support for state management.
- Verification: `python3 .imm/imm-plan.py --json docs/plans/discovery-navigation-layer.plan.md` output contains `discovery_cache` structure in steps.
- Step ID: U101
- Execution note: characterization-first (preserve existing state sync logic)

### Step 2
- Result: Bootstrap templates for discovery navigation files in imm-init.
- Verification: Run `python3 skills/imm-init/scripts/init_project.py --root ./test_bootstrap` and verify file contents.
- Step ID: U102

### Step 3
- Result: Self-evolution support for architecture maps in imm-compounder.
- Verification: Review `skills/imm-compounder/SKILL.md` and a sample solution file for `key_files` and backfill instructions.
- Step ID: U103

### Step 4
- Result: Discovery protocol enforcement for core skills.
- Verification: Review `skills/imm-brainstorm/SKILL.md` and `skills/imm-planner/SKILL.md`.
- Step ID: U104
