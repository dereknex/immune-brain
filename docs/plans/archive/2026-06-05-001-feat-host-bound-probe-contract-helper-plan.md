# Iteration Plan

## Task

- Summary: Add a narrow host-bound probe contract helper so probe-style subagent helpers reuse contract primitives without becoming a generic dispatcher.
- Origin: `imm-arch-explorer` recommended the subagent/probe helper convergence candidate after finding repeated envelope, fallback, readonly, and normalization patterns across probe-style host helpers.
- Spec: docs/specs/archive/host-bound-probe-contract-helper.spec.md
- Research: `CONTEXT.md` defines Activation Plan, Delegation Packet, Domain Mapper, State Ledger, Skill, Plan, and Spec vocabulary. `.imm/imm_core/dispatch_contracts.py` already centralizes shared dispatch vocabulary but intentionally avoids envelope construction. `.imm/imm_core/work_probes.py`, `.imm/imm_core/domain_mapper_dispatch.py`, `.imm/imm_core/brainstorm_research.py`, and `.imm/imm_core/planner_research.py` repeat readonly/no-tools/fallback/outcome-normalization scaffolding while still owning host-specific synthesis. `docs/solutions/rejected-shared-registry-generic-dispatcher.md` rejects shared registry or generic dispatcher work without stronger multi-host evidence. `docs/reference/planning-quality-gate.md` applies because this touches subagent helper contracts, runtime helpers, and packaged plugin parity.
- Decisions: D1 create a pure probe contract helper instead of a shared dispatcher. D2 migrate only probe-style helpers in this slice. D3 keep host modules responsible for envelope selection, host-specific evidence, synthesis, telemetry, and State Ledger effects. D4 put plugin parity last so every touched runtime file is covered.
- Assumptions: Existing helper tests are stable enough to prove output compatibility. A new focused `tests/test_probe_contracts.py` can guard the shared helper without requiring real subagent dispatch. Existing plugin parity tests can be extended for any new runtime file.
- Scope Mode: Hold Scope
- Planner research dispatch: solo; local code evidence is sufficient and the user did not explicitly request parallel planning research.

## Devil's Advocate Audit

### 1. Rollback Resilience

- Risk: The helper could accidentally become a generic dispatcher.
- Recovery: U1 must expose pure primitives only; if implementation starts choosing candidates, launching children, or reading config, revert the helper and replan.
- Risk: Migrating multiple host helpers could blur ownership.
- Recovery: U2 keeps host-specific synthesis and evidence fields in the original modules. If a host needs different behavior, leave it unmigrated and record the exception.
- Risk: Plugin parity could fail after repo-local helper changes.
- Recovery: U3 mirrors touched runtime files into `plugins/immune-brain/dist/.imm/` and expands parity checks; a failed U3 can be reverted without changing U1/U2 source semantics.

### 2. Verification Vanity

- Risk: Tests only prove the helper exists.
- Mitigation: U1 verification must assert no-tools policy, readonly payload fragments, fallback normalization, timeout handling, and Codex/Cursor call shape through behavior.
- Risk: Migration tests miss subtle message or fallback drift.
- Mitigation: U2 runs the existing focused host-helper tests that already assert message contents, boundaries, fallback reasons, and synthesis fields.
- Risk: Package verification checks only one file.
- Mitigation: U3 requires parity coverage for every touched runtime file or an explicit exception.

### 3. Spec Dilution Detection

- Risk: The plan could silently skip Brainstorm or Planner Research because they are less visible than Domain Mapper.
- Mitigation: U2 explicitly names work probes, Domain Mapper, Brainstorm Research, and Planner Research as the current migration surface.
- Risk: The plan could expand into party, code-review, or preplan helpers.
- Mitigation: Those helpers are non-goals unless a focused test proves the probe contract is required there.
- Risk: The rejected generic dispatcher work could be smuggled in as a helper.
- Mitigation: R1, R3, D1, and U1 all forbid dispatch ownership, subagent selection, scheduler behavior, config reads, and workflow-state writes.

## Planning Quality Gate

- contract surface: `.imm/imm_core/dispatch_contracts.py`, a new or extended `.imm/imm_core/*probe*contract*.py` helper, `.imm/imm_core/work_probes.py`, `.imm/imm_core/domain_mapper_dispatch.py`, `.imm/imm_core/brainstorm_research.py`, `.imm/imm_core/planner_research.py`, corresponding focused tests, and `plugins/immune-brain/dist/.imm/`.
- compatibility: Existing helper function names and returned semantic fields must remain compatible. Existing Plans, Specs, and State Ledger files require no migration.
- interruption recovery: U1 can close independently as a pure helper. U2 may migrate hosts incrementally but must not remove old behavior until tests pass. U3 can be retried after U1/U2 without touching workflow state.
- rollback path: Revert the files in the failed Step's discovery cache plus the matching plugin dist copy when applicable.
- verification strength: Use focused unit tests and plugin parity tests, not file-existence checks or manual inspection.
- Brainstorm traceability: Not applicable; origin is architecture exploration, not a Brainstorm manifest.
- acceptance scope discipline: Acceptance proves only this helper-convergence slice. Real subagent dispatch, activation policy changes, and broader dispatcher platformization stay deferred.

## Steps

### Step 1

- Step ID: U1
- Result: Probe contract helper defines readonly primitives
- Scope: `.imm/imm_core/dispatch_contracts.py`, new or extended `.imm/imm_core/probe_contracts.py`, `tests/test_probe_contracts.py`.
- Discovery cache: .imm/imm_core/dispatch_contracts.py (shared dispatch vocabulary); .imm/imm_core/work_probes.py (probe helper precedent); .imm/imm_core/domain_mapper_dispatch.py (Domain Mapper helper precedent); tests/test_work_probes.py (existing call-shape assertions); tests/test_domain_mapper_dispatch.py (existing mapper assertions); docs/solutions/rejected-shared-registry-generic-dispatcher.md (non-goal boundary)
- Verification: `python3 -m unittest tests.test_probe_contracts`
- Verification type: automated
- Test scenarios: Covers readonly focus payload construction; Covers no-tools policy preservation; Covers Codex and Cursor dispatch-call fragments; Covers timeout normalization; Covers fallback explanation behavior; Covers helper purity with no state writes.
- Execution note: test-first
- failure_behavior: If the helper needs to select candidates, read activation config, record telemetry, or mutate State Ledger state, stop and replan.
- security_considerations: The helper must not serialize secrets from host context beyond caller-provided bounded summaries.
- Depends on: none

### Step 2

- Step ID: U2
- Result: Probe hosts consume shared primitives
- Scope: `.imm/imm_core/work_probes.py`, `.imm/imm_core/domain_mapper_dispatch.py`, `.imm/imm_core/brainstorm_research.py`, `.imm/imm_core/planner_research.py`, `tests/test_work_probes.py`, `tests/test_domain_mapper_dispatch.py`, `tests/test_brainstorm_research.py`, `tests/test_planner_research.py`, `tests/test_probe_contracts.py`.
- Discovery cache: .imm/imm_core/work_probes.py (parallel_probes host); .imm/imm_core/domain_mapper_dispatch.py (Domain Mapper host); .imm/imm_core/brainstorm_research.py (Brainstorm manifest research host); .imm/imm_core/planner_research.py (Planner evidence research host); tests/test_work_probes.py (work probe regression); tests/test_domain_mapper_dispatch.py (mapper regression); tests/test_brainstorm_research.py (manifest synthesis regression); tests/test_planner_research.py (planner synthesis regression)
- Parallel probes: [{"scope":".imm/imm_core/work_probes.py and tests/test_work_probes.py","output":"work-probe migration constraints and stable assertions","readonly":true},{"scope":".imm/imm_core/domain_mapper_dispatch.py and tests/test_domain_mapper_dispatch.py","output":"Domain Mapper migration constraints and stable assertions","readonly":true},{"scope":".imm/imm_core/brainstorm_research.py .imm/imm_core/planner_research.py tests/test_brainstorm_research.py tests/test_planner_research.py","output":"research helper migration constraints and stable assertions","readonly":true}]
- Verification: `python3 -m unittest tests.test_probe_contracts tests.test_work_probes tests.test_domain_mapper_dispatch tests.test_brainstorm_research tests.test_planner_research`
- Verification type: automated
- Test scenarios: Covers host-owned envelope construction remains stable; Covers fallback reasons remain host visible; Covers timeout outcomes remain `timed_out`; Covers host-specific synthesis fields remain in host modules; Covers no generic dispatcher surface is introduced.
- Execution note: characterization-first
- failure_behavior: If one helper has incompatible semantics, keep that helper host-owned and record the exception instead of widening the shared helper.
- security_considerations: Migration must preserve readonly and no-tools boundaries in child messages.
- Depends on: 1

### Step 3

- Step ID: U3
- Result: Packaged runtime parity covers probe slice
- Scope: `plugins/immune-brain/dist/.imm/imm_core/`, `tests/test_immune_brain_plugin_package.py`, `tests/test_skill_contracts.py`, `docs/plans/2026-06-05-001-feat-host-bound-probe-contract-helper-plan.md`.
- Discovery cache: plugins/immune-brain/dist/.imm/imm_core/ (packaged runtime copy); tests/test_immune_brain_plugin_package.py (package parity regression); plugins/immune-brain/dist/immune_brain_runtime.py (MCP adapter surface); tests/test_skill_contracts.py (contract non-expansion guard); scripts/sync-to-public.sh (public plugin package boundary)
- Verification: `python3 -m unittest tests.test_immune_brain_plugin_package tests.test_skill_contracts && python3 .imm/imm-plan.py docs/plans/2026-06-05-001-feat-host-bound-probe-contract-helper-plan.md --json`
- Verification type: automated
- Test scenarios: Covers every touched runtime source has a matching plugin dist copy or explicit exception; Covers MCP tool listing remains available; Covers skill contracts still reject generic dispatcher expansion; Covers this Plan validates after implementation details settle.
- Execution note: characterization-first
- failure_behavior: If plugin parity exposes a missing runtime file, update parity coverage before closure rather than marking the package state as acceptable.
- security_considerations: No new external IO; packaged helper must remain pure and local.
- Depends on: 1, 2

## Validation

- Plan validator: `python3 .imm/imm-plan.py docs/plans/2026-06-05-001-feat-host-bound-probe-contract-helper-plan.md --json`
- Focused helper tests: `python3 -m unittest tests.test_probe_contracts tests.test_work_probes tests.test_domain_mapper_dispatch tests.test_brainstorm_research tests.test_planner_research`
- Package parity tests: `python3 -m unittest tests.test_immune_brain_plugin_package tests.test_skill_contracts`

## Notes

- This Plan intentionally does not create a shared registry, generic dispatcher, scheduler, or real subagent launch path.
- After validation and runtime sync, continue through `imm-work` for Step 1.
