---
title: "feat: define run completion loop"
type: feat
status: proposed
date: 2026-06-25
origin: imm-brainstorm framing - user confirmed extending existing run rather than adding a post-planner Skill
---

# Iteration Plan

## Task

- Summary: Define `run` as the outer completion loop that repeatedly coordinates `imm-autowork`, code/UI review, same-boundary `follow_up` repair, and compounder handoff without adding a new post-planner Skill.
- Spec: docs/specs/archive/run-completion-loop.spec.md
- Origin: User asked how to automate repeated `imm-work` / `imm-autowork` repair rounds after code review or UI review. Brainstorm conclusion was to extend existing `run` as the outer loop and avoid a new execution Skill.
- Research: `CONTEXT.md` defines `Plan`, `Step`, `Executor`, `QA`, `State Ledger`, and `Fast-Track`; `IMMUNE.md` defines L2S-WF as `prep` plus `run`, with `run` combining `imm-autowork`, `imm-code-review`, follow-up return, and `imm-compounder`; `plugins/immune-brain/dist/run.md` already names the autowork-review-follow-up-compounder sequence; `plugins/immune-brain/dist/imm-autowork.md` rejects a second autowork driver and preserves QA authority; `docs/solutions/rejected-autowork-driver-default-pass.md` explicitly rejects `imm-autowork-driver` and runtime default QA pass; review follow-up specs already define same-boundary `follow_up` handoff consumed by `imm-work`.
- Decisions: D1 Extend `run` rather than adding a new Skill after `imm-planner`. D2 Keep `imm-autowork` as deterministic checkpoint runtime, not final completion owner. D3 Require code review for material code, behavior, contract, runtime, or test changes and UI review for UI, visual, interaction, accessibility, responsive, or design-contract changes. D4 Same-boundary review findings loop back through `imm-autowork`; cross-boundary findings stop and route to `imm-planner`. D5 `imm-compounder` remains a terminal handoff after review closure, not an automatic continuation inside the run loop.
- Assumptions: The first executable slice can be contract-first: update `run` skill contract, README guidance, and focused tests before changing `.imm/imm-autowork.py` or adding a dedicated runtime wrapper. Existing autowork follow-up behavior is sufficient for the repair leg of the loop.
- Scope Mode: Hold Scope
- Planner research dispatch: solo; this is a workflow contract slice with clear local evidence and no need for parallel research.

## Output Language

- Human-readable prose: English
- Preserved literals: file paths, commands, schema fields, enum values, API
  names, code identifiers, and `CONTEXT.md` canonical terms

## Devil's Advocate Audit

1. **Rollback Resilience**: The first slice should touch only
   `docs/specs/archive/run-completion-loop.spec.md`, `plugins/immune-brain/dist/run.md`,
   `README.md`, `tests/test_skill_contracts.py`, and this Plan. If the contract
   proves too broad, rollback is a normal document/test revert; no State Ledger
   migration or runtime cleanup is required.
2. **Verification Vanity**: Merely checking for the phrase "completion loop" is
   too weak. Tests must prove the contract covers repeated same-boundary
   `follow_up`, both `imm-code-review` and `imm-ui-review`, stop conditions,
   `run_status` fields, and explicit rejection of new post-planner Skills,
   `imm-autowork-driver`, generic dispatchers, background schedulers, and
   runtime default QA pass.
3. **Spec Dilution Detection**: The user asked to automate repeated review/fix
   rounds. A contract-only slice could be too shallow if it leaves no executable
   path. This Plan keeps the executable path concrete by making Step 1 update
   the user-facing and skill contracts, Step 2 add regression tests, and Step 3
   decide whether runtime changes are still needed after the contract is
   anchored.

## Planning Quality Gate

- contract surface: `docs/specs/archive/run-completion-loop.spec.md`,
  `plugins/immune-brain/dist/run.md`, `README.md`,
  `plugins/immune-brain/dist/imm-autowork.md`,
  `plugins/immune-brain/dist/imm-code-review.md`,
  `plugins/immune-brain/dist/imm-ui-review.md`,
  `tests/test_skill_contracts.py`, and this Plan.
- compatibility: additive workflow contract; no Plan schema, State Ledger
  schema, MCP tool schema, or autowork queue behavior changes in the first
  slice.
- interruption recovery: if execution pauses after Step 1 or Step 2, focused
  tests and `imm-plan --json` identify the remaining contract drift.
- rollback path: revert the Spec, Plan, `run` contract text, README guidance,
  and focused tests. No data migration.
- verification strength: focused unittest assertions plus `imm-plan --json`.
  Runtime behavior changes, if promoted, require a later verification path.
- Brainstorm traceability: no persisted Brainstorm manifest was created; the
  user confirmed the direction in chat, and the confirmed decisions are captured
  in Origin and Decisions.

## Steps

### Step 1

- Step ID: U1
- Result: Completion loop contract coverage across workflow guidance
- Verification type: automated
- Verification: `python3 -m unittest tests.test_skill_contracts.SkillContractTests.test_run_completion_loop_contract_is_documented && python3 .imm/imm-plan.py docs/plans/2026-06-25-001-feat-run-completion-loop-plan.md --json`
- Execution note: test-first
- Test scenarios: Covers `run` as the outer completion loop; Covers code review and UI review gate selection; Covers same-boundary `follow_up` returning to `imm-autowork`; Covers explicit stop conditions; Covers compounder handoff only after review closure.
- Discovery cache: docs/specs/archive/run-completion-loop.spec.md (accepted behavior); plugins/immune-brain/dist/run.md (run Skill contract); README.md (user-facing L2S-WF guidance); plugins/immune-brain/dist/imm-code-review.md (code review follow-up contract); plugins/immune-brain/dist/imm-ui-review.md (UI review follow-up contract); tests/test_skill_contracts.py (focused assertions)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If the wording starts making `run` an execution or QA
  authority, stop and reword it as coordinator-only; do not move implementation
  responsibility out of `imm-autowork`, Executor, or QA.
- security_considerations: Review loops may inspect code and UI artifacts, but
  this Step does not introduce credential handling or external dispatch.

### Step 2

- Step ID: U2
- Result: Completion loop boundary regression coverage
- Verification type: automated
- Verification: `python3 -m unittest tests.test_skill_contracts.SkillContractTests.test_run_completion_loop_rejects_new_driver_and_default_pass tests.test_skill_contracts.SkillContractTests.test_run_completion_loop_status_contract && python3 .imm/imm-plan.py docs/plans/2026-06-25-001-feat-run-completion-loop-plan.md --json`
- Execution note: test-first
- Test scenarios: Covers no new post-planner Skill; Covers no `imm-autowork-driver`; Covers no generic dispatcher; Covers no background scheduler; Covers no runtime default QA pass; Covers `run_status` including review status, follow-up status, budget state, stop reason, and next recommended entry.
- Discovery cache: docs/specs/archive/run-completion-loop.spec.md (non-goals and status contract); docs/solutions/rejected-autowork-driver-default-pass.md (rejected driver and default pass); docs/solutions/rejected-shared-registry-generic-dispatcher.md (rejected dispatcher boundary); plugins/immune-brain/dist/run.md (`run_status` contract); tests/test_skill_contracts.py (regression surface)
- Agent Hint: imm-executor
- Depends on: 1
- failure_behavior: If tests require runtime behavior not promised by the first
  slice, split that into a later Plan instead of broadening this Step.
- security_considerations: Regression guards prevent hidden authority expansion
  that could bypass review or QA boundaries.

### Step 3

- Step ID: U3
- Result: Runtime follow-up needs are classified after contract adoption
- Verification type: automated
- Verification: `python3 -m unittest tests.test_skill_contracts.SkillContractTests.test_run_completion_loop_contract_is_documented tests.test_skill_contracts.SkillContractTests.test_run_completion_loop_rejects_new_driver_and_default_pass tests.test_skill_contracts.SkillContractTests.test_run_completion_loop_status_contract && python3 .imm/imm-plan.py docs/plans/2026-06-25-001-feat-run-completion-loop-plan.md --json`
- Test scenarios: Covers documentation and tests defining whether the current executable slice is contract-only; Covers any remaining runtime automation as a deferred follow-up rather than hidden scope; Covers no State Ledger schema change in this Plan.
- Discovery cache: docs/specs/archive/run-completion-loop.spec.md (Phase boundary); .imm/imm-autowork.py (existing checkpoint runtime, inspect only if needed); tests/test_imm_autowork.py (existing runtime coverage, inspect only if needed); tests/test_workflow_loop.py (workflow loop coverage, inspect only if needed)
- Agent Hint: imm-executor
- Depends on: 2
- failure_behavior: If contract adoption reveals that `run` cannot be automated
  with existing `imm-autowork` behavior, stop at a documented runtime follow-up
  recommendation and route back to `imm-planner`.
- security_considerations: Do not add new persistent queues or background
  automation without a separate security and authority review.

## Validation

- Plan validator: `python3 .imm/imm-plan.py docs/plans/2026-06-25-001-feat-run-completion-loop-plan.md --json`
- Runtime sync: `python3 .imm/imm-plan.py docs/plans/2026-06-25-001-feat-run-completion-loop-plan.md --sync`

## Notes

- This Plan is the first executable slice for Run Completion Loop. It anchors
  the contract and regression checks before runtime expansion.
- If Step 3 finds that a host runtime wrapper is needed, the next Plan should
  be a narrow runtime slice that preserves `run` as coordinator-only and
  continues using `imm-autowork` for the execution leg.
