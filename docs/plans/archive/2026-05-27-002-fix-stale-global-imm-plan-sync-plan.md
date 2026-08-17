---
title: "fix(runtime): guard stale imm-plan sync wrappers"
type: fix
status: active
date: 2026-05-27
origin: imm-brainstorm framing - global imm-plan lacks --sync while repo runtime supports it
---

# Iteration Plan

## Task
- Summary: Make explicit Plan sync reachable through plugin runtime paths while stale global imm-plan wrappers are reported by health checks
- Spec: docs/specs/stale-global-imm-plan-sync.spec.md
- Origin: Brainstorm manifest from 2026-05-27 imm-plan --sync unavailable analysis
- Brainstorm manifest: BR-REQ-001; BR-REQ-002; BR-DEC-001; BR-OUT-001; BR-Q-001
- Research: `command -v imm-plan` resolves to `/Users/derek/.local/bin/imm-plan`, which launches `/Users/derek/.immune-brain/runtime/agent-skills/.imm/imm-plan.py`; that installed runtime only exposes `--json`. Repo `.imm/imm-plan.py`, `.imm/imm_core/plan_runtime.py`, `plugins/immune-brain/dist/.imm/imm-plan.py`, `plugins/immune-brain/bin/imm-plan`, and `plugins/immune-brain/dist/immune_brain_runtime.py cli imm-plan` already expose `--sync`. `plugins/immune-brain/dist/immune_brain_runtime.py` describes `imm_plan_validate` as validate and sync but currently only maps `plan_path` plus optional `--json`. `imm-heal` checks project files but not PATH shadowing.
- Decisions: D1 resolve BR-Q-001 as stale global wrapper migration rather than installer revival; D2 add sync as an explicit MCP opt-in so validate-only remains the default; D3 add a heal warning instead of deleting or editing user-level wrappers; D4 keep State Ledger writes owned only by validated `imm-plan --sync`.
- Assumptions: The plugin-local runtime is the canonical replacement for legacy managed-copy CLI wrappers. Tests can simulate PATH shadowing with temporary directories.
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `plugins/immune-brain/dist/immune_brain_runtime.py`, `tests/test_immune_brain_mcp_runtime.py`, `.imm/imm-heal.py`, `plugins/immune-brain/dist/.imm/imm-heal.py`, `tests/test_immune_brain_plugin_package.py`
  - compatibility: validate-only remains the default for MCP and CLI calls; existing Plans and State Ledger files require no migration
  - interruption_recovery: if execution stops after MCP work but before heal work, plugin-local sync still works and the remaining Step can run independently
  - rollback_path: revert the touched runtime adapter, heal scripts, tests, and this Plan slice
  - verification_strength: unittest coverage plus direct plugin-local `imm-plan --help` smoke checks
  - blockers: none
  - replan_condition: if host MCP callers cannot pass a boolean `sync` option or if heal cannot inspect PATH without unstable environment coupling
- Devil's Advocate Audit:
  - rollback_resilience: Each Step is isolated to plugin runtime adapter or heal reporting. Reverting the touched files restores current behavior without changing State Ledger data.
  - verification_vanity: Tests must assert actual generated command arguments or process output, not merely that text exists in files.
  - spec_dilution_detection: The Plan preserves both confirmed requirements: global stale wrapper confusion is surfaced, and runtime state is not hand-written.

## Brainstorm Trace
| Item | Status | Target | Reason |
| --- | --- | --- | --- |
| BR-REQ-001 | covered_by_step | U1 | Plugin-facing sync becomes reachable through the supported runtime adapter. |
| BR-REQ-002 | captured_as_decision | D4 | State Ledger writes stay owned by validated `imm-plan --sync`. |
| BR-DEC-001 | covered_by_step | U2 | Heal reports the installed runtime drift instead of treating repo runtime as broken. |
| BR-OUT-001 | captured_as_decision | D3 | No direct edits or deletion of user-level runtime state happen in this slice. |
| BR-Q-001 | resolved_as_assumption | D1 | The plan chooses stale global wrapper migration because plugin-local runtime already supports `--sync`. |

## Steps

### Step 1
- Step ID: U1
- Result: MCP plan validation exposes explicit sync as a tested host tool option
- Verification: `python3 -m unittest tests.test_immune_brain_mcp_runtime` exits zero with assertions that `imm_plan_validate` schema includes `sync`, default calls omit `--sync`, and sync opt-in passes `--sync` to the runtime command
- Test scenarios: tools/list reports the sync property; validate-only default keeps `--sync` absent; sync true includes `--sync`; json false still omits `--json`
- Discovery cache: plugins/immune-brain/dist/immune_brain_runtime.py (MCP tool schema and command mapping); tests/test_immune_brain_mcp_runtime.py (runtime adapter contract tests)
- Depends on: none
- failure_behavior: If the MCP schema change breaks host compatibility, revert this Step and keep plugin-local CLI as the temporary sync path.

### Step 2
- Step ID: U2
- Result: Stale global imm-plan wrappers produce a tested heal warning
- Verification: `python3 -m unittest tests.test_immune_brain_plugin_package` exits zero with coverage that simulates a PATH-local `imm-plan` lacking `--sync` and verifies heal reports a stale global wrapper without touching the real home directory
- Test scenarios: no warning when PATH has no global imm-plan; no warning when global imm-plan help includes `--sync`; warning when global imm-plan help lacks `--sync`; plugin-local `plugins/immune-brain/bin/imm-plan --help` still exposes `--sync`
- Discovery cache: .imm/imm-heal.py (project health reporting); plugins/immune-brain/dist/.imm/imm-heal.py (packaged health reporting); tests/test_immune_brain_plugin_package.py (packaged runtime parity and CLI wrapper checks)
- Depends on: 1
- failure_behavior: If PATH inspection is too noisy for default heal output, keep the detector behind an environment-scoped helper and replan the user-facing warning surface.
