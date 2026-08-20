---
title: "feat: architecture convergence wave 4"
type: refactor
status: proposed
date: 2026-06-01
origin: imm-arch-explorer candidate selection
---

# Iteration Plan

## Task
- Summary: Close the five selected architecture opportunities from the latest arch-explorer run.
- Origin: User selected candidates 1,2,3,4,5 from the `imm-arch-explorer` output.
- Spec: docs/specs/archive/architecture-convergence-wave-4.spec.md
- Research: `CONTEXT.md` defines Activation Plan, Delegation Packet, Domain Mapper, State Ledger, Skill, Plan, Spec, and ADR vocabulary. `docs/solutions/rejected-shared-registry-generic-dispatcher.md` rejects shared registry and generic dispatcher work without stronger evidence. `docs/solutions/subagent-execution-truth-protocol.md` requires host-bound deterministic helpers. `docs/reference/planning-quality-gate.md` applies because this slice touches runtime helpers, plugin package parity, skill contracts, and compatibility. Current `.imm/memory/current_iteration.json` has no active Step or validated Plan.
- Candidate mapping: AEX-1 -> U1; AEX-2 -> U5; AEX-3 -> U3; AEX-4 -> U2; AEX-5 -> U4
- Decisions:
    - D1: Use a new slice rather than appending to old architecture wave plans because several old wave 3 facts are already closed or stale.
    - D2: Centralize only dispatch vocabulary and pure normalization helpers; do not create a shared dispatcher.
    - D3: Put plugin parity last so it validates every runtime surface touched by this plan.
    - D4: Treat artifact status drift as report-only in this slice.
    - D5: Keep package-first import work bounded to repo-local runtime and tests.
- Assumptions:
    - The existing unit-test suite is sufficient feedback for runtime contract changes when focused tests are added near each helper.
    - Structured registry parsing can use Python standard-library facilities or a tiny local parser without adding a runtime dependency.
    - Status drift can be detected from frontmatter, plan/spec paths, and repo-local memory evidence without rewriting files.
- Scope Mode: Hold Scope
- Planner research dispatch: solo; local evidence is sufficient and no explicit parallel research request was made.
- Engineering Closure Check:
  - contract_surface: `.imm/imm_core/*dispatch*.py`, `.imm/imm_core/skill_runtime.py`, `.imm/pyproject.toml`, `plugins/immune-brain/dist/.imm/`, `docs/specs/`, `docs/plans/`, focused tests
  - compatibility: existing Plans, Specs, State Ledger files, and plugin runtime wrappers must continue loading without migration
  - interruption_recovery: if execution stops mid-plan, completed earlier Steps remain valid because later Steps depend on earlier runtime results
  - rollback_path: revert the files named in the failed Step's discovery cache plus any matching plugin dist copy
  - verification_strength: focused unit tests, package parity checks, and `imm-plan --json` validation rather than file-existence checks
  - Brainstorm traceability: not applicable; origin is arch-explorer candidate selection, not a brainstorm manifest
  - replan_condition: if any Step needs a shared registry, generic dispatcher, automatic plan rewrite, database, or new external package distribution

## Devil's Advocate Audit

### 1. Rollback Resilience
- Risk: U1 could accidentally centralize behavior instead of vocabulary and break host-specific dispatch ownership.
- Recovery: U1 must keep host helper envelope builders in place. Reverting the new shared contract module and helper imports restores the old duplicated constants.
- Risk: U3 could rewrite historical planning artifacts and corrupt audit evidence.
- Recovery: U3 is report-only. Any write-back or auto-heal behavior requires replanning.
- Risk: U4 could make plugin or CLI wrappers fail outside editable installs.
- Recovery: U4 must preserve wrapper execution and keep dynamic loading at true wrapper/plugin boundaries.

### 2. Verification Vanity
- Risk: U1 verification could only prove the new module exists.
- Mitigation: Tests must assert helper outputs still contain the same boundary, tool policy, fallback reason, and normalized status values through the public helper functions.
- Risk: U3 verification could count files but miss stale status semantics.
- Mitigation: The check must include fixtures that intentionally contain stale, current, and unknown status cases.
- Risk: U5 verification could check only one runtime file.
- Mitigation: Package parity tests must cover every touched runtime file or force an explicit host-specific exception.

### 3. Spec Dilution Detection
- Risk: The plan could silently skip the hard import-boundary work because it is broad.
- Mitigation: AEX-5 maps to U4 and U4 has its own focused verification.
- Risk: The plan could narrow plugin parity to the files already covered today.
- Mitigation: AEX-2 maps to U5, and U5 is blocked until all touched runtime surfaces are accounted for.
- Risk: The plan could use the dispatch duplication finding as a reason to build the rejected generic dispatcher.
- Mitigation: R1, D2, and U1 explicitly limit the seam to vocabulary and pure normalization helpers.

## Steps

### Step 1
- Step ID: U1
- Result: Dispatch helper vocabulary has one runtime contract
- Verification type: automated
- Verification: `python3 -m unittest tests.test_work_probes tests.test_domain_mapper_dispatch tests.test_party_dispatch tests.test_planner_research tests.test_preplan_adversary tests.test_brainstorm_research tests.test_imm_review tests.test_skill_contracts`
- Test scenarios: shared constants preserve advisory boundary wording; no-tools policy remains stable; fallback explanations remain host visible; status normalization remains compatible; host helpers still own envelope construction
- Discovery cache: .imm/imm_core/work_probes.py (dispatch helper surface); .imm/imm_core/domain_mapper_dispatch.py (dispatch helper surface); .imm/imm_core/party_dispatch.py (dispatch helper surface); .imm/imm_core/planner_research.py (dispatch helper surface); .imm/imm_core/preplan_adversary.py (dispatch helper surface); .imm/imm_core/brainstorm_research.py (dispatch helper surface); .imm/imm_core/code_review_subagents.py (review dispatch surface); docs/solutions/rejected-shared-registry-generic-dispatcher.md (non-goal boundary)
- Parallel probes: [{"scope":"dispatch helper constants and status normalization","output":"list duplicated vocabulary and safe extraction points","readonly":true},{"scope":"focused dispatch helper tests","output":"identify assertions that must remain stable after extraction","readonly":true},{"scope":"skill contract wording","output":"identify contract text that would regress if boundary wording drifts","readonly":true}]
- Execution note: characterization-first
- Failure behavior: If shared code starts owning host selection or envelope dispatch, stop and replan.
- Depends on: none

### Step 2
- Step ID: U2
- Result: Skill registry loading uses structured parsing
- Verification type: automated
- Verification: `python3 -m unittest tests.test_skill_contracts`
- Test scenarios: valid registry entries load with role boundary and next action metadata; missing required fields still fail; malformed registry shape fails loudly; existing step activation constraints remain unchanged
- Discovery cache: .imm/imm_core/skill_runtime.py (registry loader); plugins/immune-brain/skills/registry.yaml (registry source); tests/test_skill_contracts.py (registry contract tests); docs/solutions/live-inventory-source-of-truth.md (source of truth guidance)
- Execution note: test-first
- Failure behavior: If structured loading needs a new runtime dependency, stop and replan.
- Depends on: 1

### Step 3
- Step ID: U3
- Result: Planning artifact status drift has a reportable check
- Verification type: automated
- Verification: `python3 -m unittest tests.test_compound_debt_inventory tests.test_skill_contracts`
- Test scenarios: stale status fixture is reported; current status fixture is ignored; unknown evidence stays ambiguous; report output names affected plan or spec paths; no historical artifact is rewritten
- Discovery cache: .imm/imm-compound-debt.py (repo-local inventory pattern); scripts/detect-stale-refs.py (deterministic docs scan pattern); docs/specs/ (spec status surface); docs/plans/ (plan status surface); .imm/memory/MEMORY.md (durable evidence input)
- Execution note: test-first
- Failure behavior: If reliable detection requires rewriting historical plans or adding a new authority file, stop and replan.
- Depends on: 2

### Step 4
- Step ID: U4
- Result: imm_core imports use package first paths
- Verification type: automated
- Verification: `python3 -m unittest tests.test_imm_plan tests.test_current_iteration_state tests.test_workflow_loop tests.test_immune_brain_mcp_runtime`
- Test scenarios: repo-local runtime imports `imm_core` through package paths; CLI wrappers still run from the repository root; plugin runtime remains isolated; dynamic file loading remains only at wrapper or plugin-copy boundaries
- Discovery cache: .imm/pyproject.toml (package metadata); .imm/imm-plan.py (CLI wrapper import path); .imm/activation_plan.py (CLI wrapper import path); .imm/imm-work.py (runtime import path); .imm/imm-autowork.py (dynamic wrapper boundary); tests/test_imm_plan.py (runtime import tests); tests/test_workflow_loop.py (workflow import tests); tests/test_immune_brain_mcp_runtime.py (plugin isolation tests)
- Execution note: characterization-first
- Failure behavior: If package-first imports break plugin-only copies, preserve the dynamic boundary and narrow the Step.
- Depends on: 3

### Step 5
- Step ID: U5
- Result: Packaged runtime parity covers every touched source
- Verification type: automated
- Verification: `python3 -m unittest tests.test_immune_brain_plugin_package tests.test_skill_contracts`
- Test scenarios: every runtime source touched in U1-U4 has matching plugin dist content or a documented host-specific exception; MCP tool listing still works; public release sync still keeps plugin package as the public runtime surface; skill contract tests still pass
- Discovery cache: plugins/immune-brain/dist/.imm/ (packaged runtime copy); plugins/immune-brain/dist/immune_brain_runtime.py (MCP adapter); tests/test_immune_brain_plugin_package.py (package parity tests); tests/test_skill_contracts.py (compiled skill contract tests); scripts/sync-to-public.sh (public package boundary)
- Execution note: characterization-first
- Failure behavior: If parity cannot be proven for a touched file, do not hand off closure until the exception is explicit.
- Depends on: 4

## Next Action

After validation and sync, continue through `imm-work` for Step 1.
