---
title: "fix(runtime): use packaged registry for business repos"
type: fix
status: proposed
date: 2026-06-08
origin: imm-brainstorm framing - refine business repository missing skills registry blocker
---

# Iteration Plan

## Task

- Summary: Make Immune-Brain workflow runtime use its packaged/source Skill registry for business repositories.
- Spec: docs/specs/archive/packaged-registry-fallback.spec.md
- Origin: Brainstorm manifest from 2026-06-08 registry fallback blocker investigation.
- Brainstorm manifest: BR-REQ-001; BR-REQ-002; BR-OUT-001; BR-DEC-001; BR-Q-001
- Research: `CONTEXT.md` defines Skill as an Immune-Brain role-scoped contract and identifies `skills/registry.yaml` as the Skill contract registry for this project. `refine` has `.imm/memory/` and plans but no `skills/registry.yaml`; its state history shows repeated manual workflow records because `skills/registry.yaml` was missing. The Immune-Brain source/plugin package already carries registry copies at `plugins/immune-brain/skills/registry.yaml` and `plugins/immune-brain/dist/registry.yaml`. `.imm/imm-work.py` owns activation-time registry loading through `load_skill_runtime`, while `.imm/imm_core/skill_runtime.py` owns registry parsing and role constraint validation. `plugins/immune-brain/dist/immune_brain_runtime.py` owns plugin command dispatch and must keep the business repository as cwd without selecting stale business `.imm` scripts over packaged runtime scripts. Packaged runtime contract tests already cover `plugins/immune-brain/dist/immune_brain_runtime.py` and `dist/registry.yaml` existence.
- Decisions: D1 treat target business repository `skills/registry.yaml` as out of scope for Skill registry resolution. D2 use Immune-Brain packaged/source registry as the required source for workflow Skill constraints. D3 do not preserve business project registry precedence because business repositories should not define Immune-Brain Skill authority. D4 make missing-registry failures name the required Immune-Brain registry source instead of telling business repos to vendor Skill contracts. D5 implement this as a new one-step Plan because the current blocker is a runtime contract defect, not a `refine` U1 implementation issue.
- Assumptions: The registry schema and Skill metadata are already correct; the defect is lookup ownership and error handling. A focused unit test with a temporary business project root is enough to prove the blocker class without mutating `refine`.
- Scope Mode: Hold Scope
- Planner research dispatch: solo; this is a small runtime/test slice and local evidence is sufficient.

## Brainstorm Trace

| Item | Status | Target | Reason |
| --- | --- | --- | --- |
| BR-REQ-001 | covered_by_step | U1 | The step makes workflow registry setup use Immune-Brain-owned registry files instead of business project `skills/registry.yaml`. |
| BR-REQ-002 | covered_by_step | U1 | The step improves missing-registry diagnostics so optional business-repo absence is distinct from required runtime registry absence. |
| BR-OUT-001 | captured_as_decision | D1 | The plan explicitly excludes adding `skills/registry.yaml` to `refine` or other business repositories. |
| BR-DEC-001 | captured_as_decision | D2 | The plan records packaged/source registry fallback as the chosen ownership boundary. |
| BR-Q-001 | resolved_as_assumption | D1 | The user confirmed `refine` is a business repository and should not carry a full Skill registry. |

## Devil's Advocate Audit

1. **Rollback Resilience**: This slice should touch only registry resolver code, focused tests, this Spec, and this Plan. If fallback resolution introduces unexpected behavior, revert those files together; no business repository migration or State Ledger rewrite is required.
2. **Verification Vanity**: A test that only checks `dist/registry.yaml` exists would miss the blocker. Verification must exercise registry loading with project roots that lack or contain a fake business `skills/registry.yaml` and prove Skill constraints still resolve from Immune-Brain-owned registry files.
3. **Spec Dilution Detection**: The accepted requirement is not merely better wording. The Plan requires actual workflow registry setup to stop failing for business repositories, while preserving clear failure if the packaged/source registry is also missing.

## Planning Quality Gate

- contract surface: `.imm/imm-work.py`, `.imm/imm_core/skill_runtime.py`, `plugins/immune-brain/dist/.imm/imm-work.py`, `plugins/immune-brain/dist/immune_brain_runtime.py`, `plugins/immune-brain/skills/registry.yaml`, `plugins/immune-brain/dist/registry.yaml`, `tests/test_skill_contracts.py`, `tests/test_immune_brain_plugin_package.py`, `tests/test_immune_brain_mcp_runtime.py`, and this Spec.
- compatibility: Business repositories always use Immune-Brain-owned registry files for Skill authority. The target repository remains cwd and State Ledger owner.
- interruption recovery: If execution stops after partial resolver edits, `python3 -m unittest tests.test_skill_contracts tests.test_immune_brain_plugin_package tests.test_immune_brain_mcp_runtime` identifies whether source and packaged runtime paths still agree.
- rollback path: Revert resolver/test/spec/plan edits together. No `refine` rollback is needed because that repo is out of scope.
- verification strength: Use focused unit coverage for missing business-repo registry plus existing packaged runtime tests. Avoid manual `refine` mutation as proof.
- Brainstorm traceability: Every `BR-*` item from the brainstorm manifest is mapped above.

## Steps

### Step 1

- Step ID: U1
- Result: Source/dist registry is authoritative for business repositories
- Verification: `python3 -m unittest tests.test_skill_contracts tests.test_immune_brain_plugin_package tests.test_immune_brain_mcp_runtime && python3 .imm/imm-plan.py docs/plans/2026-06-08-004-fix-packaged-registry-fallback-plan.md --json`
- Verification type: automated
- Execution note: test-first
- Test scenarios: A temporary business project root with no `skills/registry.yaml` can load activation constraints for `imm-work`, `imm-executor`, and `imm-qa`; a temporary business project root with a fake `skills/registry.yaml` still uses Immune-Brain-owned registry files; plugin command resolution prefers packaged runtime over a stale business repository `.imm` runtime; if no Immune-Brain-owned registry exists, the error names the required runtime registry source; packaged runtime tests continue to find and use `dist/registry.yaml`; no `refine/skills/registry.yaml` fixture or mutation is introduced.
- Discovery cache: .imm/imm-work.py (activation registry lookup); .imm/imm_core/skill_runtime.py (registry parsing and constraint validation); plugins/immune-brain/dist/.imm/imm-work.py (packaged activation registry lookup); plugins/immune-brain/dist/immune_brain_runtime.py (packaged runtime adapter); plugins/immune-brain/skills/registry.yaml (source registry fallback); plugins/immune-brain/dist/registry.yaml (packaged registry fallback); tests/test_skill_contracts.py (SkillRuntime contract tests); tests/test_immune_brain_plugin_package.py (packaged plugin regression tests); tests/test_immune_brain_mcp_runtime.py (MCP runtime adapter tests); docs/specs/archive/packaged-registry-fallback.spec.md (accepted behavior)
- Depends on: none
- failure_behavior: If packaged runtime and source runtime resolve registry paths differently, keep the user-visible behavior identical and add separate focused assertions rather than asking business repositories to carry fallback files.
- security_considerations: Registry fallback must read only Immune-Brain-owned registry files and must not scan arbitrary parent directories or expose business repository secrets in diagnostics.

## Validation

- Plan validator: `python3 .imm/imm-plan.py docs/plans/2026-06-08-004-fix-packaged-registry-fallback-plan.md --json`
- Runtime sync: `python3 .imm/imm-plan.py docs/plans/2026-06-08-004-fix-packaged-registry-fallback-plan.md --sync`

## Notes

- This Plan intentionally does not add or modify files under `/Users/derek/workspaces/refine`.
- After validation and runtime sync, continue through `imm-work` for Step 1.
