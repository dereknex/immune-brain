---
title: "feat: add run review closure runtime gate"
type: feat
status: proposed
date: 2026-06-25
origin: imm-planner direct entry - user reported that manual code review still finds issues after imm-run completes
---

# Iteration Plan

## Task

- Summary: Add a minimal multi-round runtime review gate so `run` cannot treat
  material Plan or `follow_up` closure as final completion before all required
  `imm-code-review` or `imm-ui-review` rounds are surfaced and closed.
- Spec: docs/specs/archive/run-review-closure-runtime-gate.spec.md
- Origin: The user reported that after executing `imm-run`, manually running
  code review still finds problems, then clarified that most cases need
  multiple review plus `imm-work` rounds before they are truly complete. This
  shows the current completion loop can hand off too early and must model
  repeated review/follow-up rounds.
- Research: `docs/specs/archive/run-completion-loop.spec.md` defines the desired outer
  loop but marks the adopted slice as contract-only; `.imm/imm-autowork.py`
  currently returns `finished` or `follow_up_complete` with `handoff_only` when
  Plan or `follow_up` closure completes; `plugins/immune-brain/dist/run.md`
  documents review gates but has no machine-enforced closure stop;
  `tests/test_imm_autowork.py` already covers completion and follow-up closure
  boundaries; `docs/solutions/rejected-autowork-driver-default-pass.md` and
  `docs/solutions/rejected-shared-registry-generic-dispatcher.md` reject the
  main expansion traps.
- Decisions: D1 Treat this as a new runtime slice, not an append to the closed
  contract-only Plan. D2 Use `imm-autowork`/`run_status` as the minimal runtime
  stop surface; do not add a `run` shell command or new Skill. D3 Stop at a
  review-required boundary after material changed files, including after each
  same-boundary `follow_up` repair, instead of handing off to `imm-compounder`.
  D4 Keep advisory review authority in
  `imm-code-review`/`imm-ui-review`; the runtime only surfaces the required
  gate and changed-file evidence. D5 Re-run the review gate after same-boundary
  `follow_up` closure before compounder handoff. D6 Expose review/follow-up
  round state and budget stops so multi-round repair remains bounded.
- Assumptions: The first executable runtime slice prevents premature final
  completion across one or more review/follow-up rounds. It does not implement
  autonomous review execution or durable cross-session review-pass persistence.
  The host `run` Skill remains responsible for invoking the required reviewer
  after each runtime stop.
- Scope Mode: Hold Scope
- Planner research dispatch: solo; the relevant runtime, contract, rejected
  decisions, and tests were available from local discovery, so additional
  readonly subagents would not change step decomposition.

## Output Language

- Human-readable prose: English
- Preserved literals: file paths, commands, schema fields, enum values, API
  names, code identifiers, and `CONTEXT.md` canonical terms

## Devil's Advocate Audit

1. **Rollback Resilience**: The runtime slice should be revertible by rolling
   back `.imm/imm-autowork.py`, its packaged runtime copy, the focused tests,
   `run` contract/registry wording, and this Spec/Plan. No State Ledger
   migration or data cleanup should be required.
2. **Verification Vanity**: A test that only checks the words "review closure"
   would not catch the user-reported failure. The verification must construct a
   completed Plan or completed `follow_up` with material changed files and prove
   the snapshot stops at a review-required boundary instead of returning
   compounder. It must also prove a follow-up repair returns to review again, so
   a single gate cannot masquerade as multi-round closure.
3. **Spec Dilution Detection**: The user wants `run` not to finish while code
   review can still find issues. Narrowing this to another documentation update
   would dilute the requirement. This Plan requires an executable stop while
   still avoiding autonomous reviewer execution or authority expansion.

## Planning Quality Gate

- contract surface: `docs/specs/archive/run-review-closure-runtime-gate.spec.md`,
  `plugins/immune-brain/dist/run.md`,
  `plugins/immune-brain/dist/registry.yaml`, `.imm/imm-autowork.py`,
  `plugins/immune-brain/dist/.imm/imm-autowork.py`,
  `tests/test_imm_autowork.py`, `tests/test_skill_contracts.py`, and packaged
  runtime parity tests.
- compatibility: additive and backwards compatible. Existing State Ledger
  files remain valid; new review-gate and round-state fields in autowork
  snapshots must be optional/derived.
- interruption recovery: if execution stops after only the runtime step,
  `imm-autowork` should safely stop at review-required boundaries, and a later
  `imm-work` run should still continue from the same active Step or
  `follow_up` state.
- rollback path: revert the Spec, Plan, runtime files, packaged runtime copy,
  run contract/registry updates, and focused tests. No `.imm/memory/` migration
  should need rollback beyond the normal active Plan sync.
- verification strength: focused unit tests for autowork completion boundaries
  and repeated follow-up review resurfacing, skill contract tests for route
  visibility, packaged runtime parity, and plan validation with
  `imm-plan --json`.
- Brainstorm traceability: no persisted Brainstorm manifest exists. The
  direct user signal is captured in Origin and Research.

## Steps

### Step 1

- Step ID: U1
- Result: Completion boundary requires review evidence
- Verification type: automated
- Verification: `python3 -m unittest tests.test_imm_autowork.ImmAutoworkTests.test_completed_material_run_requires_code_review_gate tests.test_imm_autowork.ImmAutoworkTests.test_completed_ui_run_requires_ui_review_gate tests.test_imm_autowork.ImmAutoworkTests.test_follow_up_completion_requires_review_before_compounder tests.test_imm_autowork.ImmAutoworkTests.test_multi_round_follow_up_resurfaces_review_gate && python3 .imm/imm-plan.py docs/plans/2026-06-25-003-feat-run-review-closure-runtime-gate-plan.md --json`
- Execution note: test-first
- Test scenarios: Completed Plan with material changed files stops at
  `review_required` and recommends `imm-code-review`; UI changed files expose
  `imm-ui-review`; completed same-boundary `follow_up` with material changed
  files does not hand off to `imm-compounder` before review; a second
  same-boundary follow-up round re-surfaces the relevant review gate instead of
  pretending the first repair round was final closure.
- Discovery cache: .imm/imm-autowork.py (runtime completion stop);
  plugins/immune-brain/dist/.imm/imm-autowork.py (packaged parity);
  tests/test_imm_autowork.py (focused runtime coverage);
  docs/specs/archive/run-review-closure-runtime-gate.spec.md (accepted behavior)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If the gate needs durable review-pass state to distinguish
  review closure from another required review round, stop and route back to
  `imm-planner` rather than adding a State Ledger schema change inside this
  Step.
- security_considerations: The gate inspects changed-file paths and execution
  evidence only; it must not read secrets or dispatch advisory subagents.

### Step 2

- Step ID: U2
- Result: Installed run contract exposes the runtime review gate
- Verification type: automated
- Verification: `python3 -m unittest tests.test_skill_contracts.SkillContractTests.test_run_runtime_review_gate_contract tests.test_skill_contracts.SkillContractTests.test_run_registry_includes_review_gate_routes tests.test_immune_brain_plugin_package.PluginPackageTest.test_packaged_runtime_matches_repo_runtime_sources && python3 .imm/imm-plan.py docs/plans/2026-06-25-003-feat-run-review-closure-runtime-gate-plan.md --json`
- Execution note: test-first
- Test scenarios: `run` contract says completion is blocked until required
  review gates are surfaced and repeated as needed; registry next actions
  include both `imm-code-review` and `imm-ui-review`; packaged runtime parity
  includes the review-gate runtime change.
- Discovery cache: plugins/immune-brain/dist/run.md (run Skill contract);
  plugins/immune-brain/dist/registry.yaml (installed route surface);
  plugins/immune-brain/skills/registry.yaml (source registry);
  tests/test_skill_contracts.py (contract tests);
  tests/test_immune_brain_plugin_package.py (packaged runtime parity)
- Agent Hint: imm-executor
- Depends on: 1
- failure_behavior: If contract updates imply a new `run` shell command,
  `imm-autowork-driver`, generic dispatcher, background scheduler, or runtime
  default QA pass, stop and re-scope before editing implementation files.
- security_considerations: Review subagent dispatch remains controlled by the
  existing activation-plan and authorization gates; this Step must not promise
  unconditional subagent dispatch.

## Validation

- Plan validator: `python3 .imm/imm-plan.py docs/plans/2026-06-25-003-feat-run-review-closure-runtime-gate-plan.md --json`
- Runtime sync: `python3 .imm/imm-plan.py docs/plans/2026-06-25-003-feat-run-review-closure-runtime-gate-plan.md --sync`

## Notes

- This Plan intentionally promotes the deferred runtime wrapper concern from
  `docs/specs/archive/run-completion-loop.spec.md` R7 into a narrow executable slice.
- The key success condition is negative: a material `run` must not claim final
  completion while manual `imm-code-review` could still be the first or next
  required review gate.
