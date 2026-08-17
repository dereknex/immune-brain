# Iteration Plan

## Task

- Summary: Add a roadmap versus executable slice contract so large Immune-Brain tasks preserve full roadmap context while current Plans only promise the active executable slice.
- Origin: User asked how Immune-Brain should handle large tasks without losing later-phase discussion content or misleading users about what the current Plan implements.
- Spec: docs/specs/roadmap-executable-slice-contract.spec.md
- Research: `IMMUNE.md` already defines Plan Steps as independently closable outcome units and allows fewer outcome Steps for larger stable capability boundaries. `docs/reference/workflow-and-subagents.md` says planner normally creates a small Step plan and `imm-work` advances only the current Step. `docs/reference/planning-quality-gate.md` already covers elevated-risk planning checks but does not mention roadmap information preservation. `plugins/immune-brain/dist/imm-planner.md` currently supports `covered_by_step`, `deferred`, and `out_of_scope` but has no `partially_covered` status or current-slice banner rule. `.imm/templates/iteration-plan-template.md` has no roadmap continuation fields.
- Decisions: D1 keep this as a contract and validator-hardening slice rather than a new roadmap runtime. D2 add `partially_covered` as a truthful trace status instead of overloading `covered_by_step`. D3 make roadmap ceremony conditional for large or multi-phase work only. D4 update templates after the contract and parser behavior are in place.
- Assumptions: Existing compiled skill text under `plugins/immune-brain/dist/` is the contract surface guarded by tests. Existing Plans remain valid because the new status is additive and optional.
- Brainstorm manifest: BR-REQ-001; BR-REQ-002; BR-REQ-003; BR-REQ-004; BR-REQ-005; BR-DEC-001; BR-OUT-001; BR-Q-001

## Brainstorm Manifest

- BR-REQ-001: Separate roadmap memory from current executable Plan commitment.
- BR-REQ-002: Preserve all discussed future-phase content with next actions.
- BR-REQ-003: Show users the implementation route for deferred roadmap phases.
- BR-REQ-004: Avoid claiming compound requirements are fully covered when only part of them is in the current Plan.
- BR-REQ-005: Add durable tests and templates so the behavior survives later edits.
- BR-DEC-001: Improve planner contract first and avoid a broad roadmap runtime.
- BR-OUT-001: Do not make `imm-work` automatically execute deferred phases.
- BR-Q-001: No open product blocker remains after the user chose a planner-owned improvement plan.

## Brainstorm Trace

| Item | Status | Target | Reason |
| --- | --- | --- | --- |
| BR-REQ-001 | covered_by_step | U1 | Planner contract separates roadmap memory from executable Plan commitment. |
| BR-REQ-002 | covered_by_step | U1 | Planner and quality-gate guidance preserve deferred discussion content. |
| BR-REQ-003 | covered_by_step | U3 | Template continuation fields show the route into later Plans. |
| BR-REQ-004 | covered_by_step | U2 | Runtime trace validation gains partial coverage semantics. |
| BR-REQ-005 | covered_by_step | U3 | Contract tests and parser tests become the durability guard. |
| BR-DEC-001 | captured_as_decision | D1 | The slice is contract and validator hardening only. |
| BR-OUT-001 | out_of_scope | Scope | Deferred phase execution remains outside `imm-work` automation. |
| BR-Q-001 | resolved_as_assumption | Assumptions | User supplied the desired improvement direction and asked for planning. |

## Devil's Advocate Audit

1. **Rollback Resilience**: U1 and U3 are documentation or template contract edits that can be reverted by file path. U2 is an additive parser status change with focused tests; if it fails, revert `.imm/imm_core/plan_runtime.py` and the matching parser tests without touching existing Plans.
2. **Verification Vanity**: The verification is not just text search. U2 must prove the parser accepts `partially_covered` and rejects reasonless partial rows. U1 and U3 add skill-contract tests so wording regressions fail instead of relying on manual inspection.
3. **Spec Dilution Detection**: All user-requested concerns are mapped: route clarity, roadmap information preservation, no false full-coverage claims, deferred next actions, and durable tests. Runtime roadmap orchestration is explicitly excluded rather than silently skipped.

## Planning Quality Gate

- contract surface: `plugins/immune-brain/dist/imm-planner.md`, `docs/reference/planning-quality-gate.md`, `CONTEXT.md`, `.imm/templates/iteration-plan-template.md`, `.imm/imm_core/plan_runtime.py`, `tests/test_skill_contracts.py`, and `tests/test_imm_plan.py`.
- compatibility: Existing Plans and Brainstorm Trace statuses remain valid. The new `partially_covered` status is additive.
- interruption recovery: U1 can land independently as contract wording. U2 can land independently as parser behavior. U3 should follow so templates match the new contract.
- rollback path: Revert the files touched by the failed Step; no State Ledger migration or data rewrite is planned.
- verification strength: Use unit tests for parser behavior and contract tests for planner guidance. Validate this Plan with `imm-plan --json`.
- Brainstorm traceability: Every `BR-*` item is mapped above before execution.

## Steps

### Step 1

- Step ID: U1
- Result: Planner contract separates Roadmap from executable slices
- Scope: `CONTEXT.md`, `IMMUNE.md`, `plugins/immune-brain/dist/imm-planner.md`, `docs/reference/planning-quality-gate.md`, `docs/reference/workflow-and-subagents.md`, `tests/test_skill_contracts.py`.
- Discovery cache: plugins/immune-brain/dist/imm-planner.md (planner contract surface); docs/reference/planning-quality-gate.md (elevated-risk planning checklist); CONTEXT.md (canonical term registry); tests/test_skill_contracts.py (contract regression suite)
- Verification: `python3 -m unittest tests.test_skill_contracts`
- Verification type: automated
- Test scenarios: Covers roadmap versus executable slice rule; Covers current-slice banner wording; Covers roadmap information preservation checks; Covers Roadmap term distinction from Plan.
- failure_behavior: If contract wording conflicts with existing small-task guidance, keep small tasks concise and limit roadmap rules to large or multi-phase work.
- security_considerations: No security-sensitive behavior changes; guidance must avoid telling planners to preserve secrets or raw private discussion payloads.
- Depends on: none

### Step 2

- Step ID: U2
- Result: Origin trace supports partial coverage
- Scope: `.imm/imm_core/plan_runtime.py`, `tests/test_imm_plan.py`.
- Discovery cache: .imm/imm_core/plan_runtime.py (Brainstorm Trace status validation); tests/test_imm_plan.py (origin coverage parser tests)
- Verification: `python3 -m unittest tests.test_imm_plan`
- Verification type: automated
- Test scenarios: Covers `partially_covered` as a legal Brainstorm Trace status; Covers reason required for partial coverage; Covers existing covered, deferred, and out-of-scope behavior remains valid.
- Execution note: test-first
- failure_behavior: If the parser change implies broader origin coverage semantics, stop after tests expose the gap and replan instead of expanding the validator.
- security_considerations: No new IO or trust boundary; parser must continue rejecting malformed Brainstorm IDs.
- Depends on: 1

### Step 3

- Step ID: U3
- Result: Templates preserve roadmap continuation fields
- Scope: `.imm/templates/iteration-plan-template.md`, `plugins/immune-brain/skills/imm-init/templates/`, `tests/test_skill_contracts.py`, `tests/test_imm_plan.py`.
- Discovery cache: .imm/templates/iteration-plan-template.md (Plan authoring template); plugins/immune-brain/skills/imm-init/templates/ (bootstrap template surface); tests/test_skill_contracts.py (template and guidance contract tests)
- Verification: `python3 -m unittest tests.test_imm_plan tests.test_skill_contracts && python3 .imm/imm-plan.py docs/plans/2026-06-03-001-feat-roadmap-executable-slice-contract-plan.md --json`
- Verification type: automated
- Test scenarios: Covers optional roadmap source field; Covers execution scope field; Covers deferred phase field; Covers roadmap continuation block with next Plan path.
- failure_behavior: If bootstrap templates do not own Plan format, limit the edit to `.imm/templates/iteration-plan-template.md` and record the skipped surface in execution evidence.
- security_considerations: Template guidance must remind planners not to preserve secrets, credentials, or raw sensitive payloads as roadmap memory.
- Depends on: 1, 2

## Validation

- Plan validator: `python3 .imm/imm-plan.py docs/plans/2026-06-03-001-feat-roadmap-executable-slice-contract-plan.md --json`
- Focused parser tests: `python3 -m unittest tests.test_imm_plan`
- Focused contract tests: `python3 -m unittest tests.test_skill_contracts`
- Full planned verification: `python3 -m unittest tests.test_imm_plan tests.test_skill_contracts`

## Notes

- This Plan intentionally does not create a roadmap execution engine.
- After validation and runtime sync, use `imm-work` to activate Step 1.
