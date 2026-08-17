---
title: "fix: simplify autorun workflow boundaries"
type: fix
status: planned
date: 2026-07-03
origin:
  - user-confirmed strong autorun direction
  - docs/specs/2026-07-03-autorun-boundary-simplification.spec.md
---

# Iteration Plan

## Task

- Summary: Make `imm-loop` the sole user-facing strong autorun entry while simplifying `imm-autowork` into a backwards-compatible checkpoint runtime.
- Spec: docs/specs/2026-07-03-autorun-boundary-simplification.spec.md
- Origin: The user reported that `imm-loop` still frequently stops and then selected strong autorun mode. Follow-up discussion identified overlap between `imm-loop` and `imm-autowork`, then chose simplification instead of deletion: preserve `imm-autowork` as checkpoint compatibility while making `imm-loop` the only user-facing autorun coordinator.
- Research: `CONTEXT.md` defines State Ledger, Skill, Plan, Step, QA, and Compounder vocabulary. `IMMUNE.md` already says `imm-autowork` is a deterministic checkpoint runtime rather than a new Skill authority, but active contract text still exposes host-loop and `can_auto_advance` language. `plugins/immune-brain/runtime/immune_brain_runtime.ts` currently implements `runAutoworkCommand` as snapshot generation plus explicit queue consumption. `docs/solutions/rejected-autowork-driver-default-pass.md` rejects adding `imm-autowork-driver` or converting executor verification into QA pass. `docs/solutions/opt-in-bounded-autowork-entry.md` explains why the historical autowork entry existed, while the new `imm-loop` user-facing role makes that entry redundant as a product surface. The closed plan `docs/plans/2026-07-02-001-feat-imm-loop-review-lifecycle-runtime-plan.md` already delivered review lifecycle runtime support and now needs contract simplification around it.
- Decisions: D1 Treat `imm-loop` as the only user-facing strong autorun Skill. D2 Keep `imm-autowork` CLI and MCP surfaces in this slice as compatible checkpoint primitives. D3 Remove active `can_auto_advance` guidance from current contracts and use `stop_reason` snapshots as the runtime contract. D4 Do not add `imm-loop` shell command until a later slice proves it is needed. D5 Do not add `imm-autowork-driver`, generic dispatcher, background scheduler, or runtime default QA pass. D6 Update registry and docs so `imm-autowork` no longer competes with `imm-loop` in user-facing routing.
- Assumptions: Existing hosts may still call `imm-autowork` directly, so this slice must preserve command compatibility. Historical archived solution notes may keep old wording if active contracts are clear. The implementation can update package registry and focused tests without changing State Ledger schema.
- Brainstorm manifest: BR-REQ-001; BR-REQ-002; BR-REQ-003; BR-DEC-001; BR-DEC-002; BR-OUT-001; BR-Q-001
- Scope Mode: Hold Scope
- Planner research dispatch: solo; existing specs, closed runtime plan, runtime code, registry, and rejected decisions are enough to define the executable slice.

## Output Language

- Human-readable prose: English
- Preserved literals: file paths, commands, schema fields, enum values, API names, JSON keys, Skill names, and `CONTEXT.md` canonical terms such as `Plan`, `Step`, `Skill`, `QA`, `State Ledger`, and `Compounder`.

## Brainstorm manifest

| Item | Statement |
|------|-----------|
| BR-REQ-001 | `imm-loop` must automatically continue from `awaiting_execution_input` into the `imm-work` or executor path. |
| BR-REQ-002 | Autorun must not bypass `imm-work`, executor, QA, review gates, or compounder authority boundaries. |
| BR-REQ-003 | Real stop conditions remain blocker, QA rework, QA replan, review follow-up, budget, tool failure, and scope drift. |
| BR-DEC-001 | Use strong autorun mode instead of only improving the manual prompt text. |
| BR-DEC-002 | Preserve `imm-autowork` as checkpoint compatibility rather than deleting it in this slice. |
| BR-OUT-001 | Do not add `imm-autowork-driver`, generic dispatcher, background scheduler, or runtime default QA pass. |
| BR-Q-001 | Whether to add a runtime-level `imm-loop` command is resolved as deferred because the current slice can simplify Skill and runtime contracts without it. |

## Brainstorm Trace

| Item | Status | Target | Reason |
|------|--------|--------|--------|
| BR-REQ-001 | covered_by_step | U1 | U1 updates active contracts and tests so `awaiting_execution_input` is a loop continuation boundary. |
| BR-REQ-002 | covered_by_step | U1 | U1 preserves checkpoint-only autowork and authority boundary tests. |
| BR-REQ-003 | covered_by_step | U1 | U1 keeps stop reason based checkpoint behavior and focused tests for QA rework, replan, budget, and review gates. |
| BR-DEC-001 | captured_as_decision | D1 | D1 names `imm-loop` as the sole user-facing strong autorun Skill. |
| BR-DEC-002 | captured_as_decision | D2 | D2 keeps the compatible checkpoint primitive. |
| BR-OUT-001 | covered_by_step | U1 | U1 verification asserts no new driver or default QA pass surface. |
| BR-Q-001 | resolved_as_assumption | D4 | D4 defers an `imm-loop` shell command because the current simplification can land through existing Skill and checkpoint surfaces. |

## Devil's Advocate Audit

1. **Rollback Resilience**: The slice is rollback-safe by reverting the new Spec, this Plan, skill contract wording, registry wording, README or user manual edits, and focused tests together. Runtime command compatibility is preserved, so rollback does not require State Ledger migration or cleanup.
2. **Verification Vanity**: Verification must not only check that text exists. Focused tests and contract assertions must prove that active surfaces no longer present `imm-autowork` as a competing user-facing loop, that checkpoint runtime behavior still works, and that package metadata still exposes compatible commands.
3. **Spec Dilution Detection**: The plan does not silently narrow strong autorun into documentation-only guidance. It explicitly maps `awaiting_execution_input` to `imm-loop` continuation semantics while preserving the authority split and keeping deletion of `imm-autowork` out of scope only for compatibility reasons.

## Planning Quality Gate

- **contract surface**: `plugins/immune-brain/dist/imm-loop.md`, `plugins/immune-brain/dist/imm-autowork.md`, `plugins/immune-brain/skills/imm-loop/SKILL.md`, `plugins/immune-brain/skills/imm-autowork/SKILL.md`, `plugins/immune-brain/dist/registry.yaml`, `plugins/immune-brain/skills/registry.yaml`, `README.md`, `docs/user_manual.md`, `IMMUNE.md`, focused tests under `tests/`, and package runtime parity tests.
- **compatibility**: Existing `imm-autowork` CLI and MCP consumers remain supported. No State Ledger schema migration is planned. Existing historical plans and archived solution notes remain readable.
- **interruption recovery**: If execution stops midway, rerun focused contract tests to find the stale surface. Since runtime command compatibility is unchanged, active workflow state remains usable by `imm-work` and `imm-loop`.
- **rollback path**: Revert this Spec, this Plan, contract docs, registry entries, README or user manual edits, and focused tests as one coherent slice. No `.imm/memory/` rollback is required beyond plan sync state.
- **verification strength**: Use Bun runtime tests, package parity tests, plan validation, and text-negative contract assertions for stale active wording. Avoid accepting manual reading alone.
- **Brainstorm traceability**: Every BR-* item from the conversation manifest is mapped in `Brainstorm Trace`; `BR-Q-001` is resolved by D4.

## Steps

### Step 1

- Step ID: U1
- Result: Autorun boundaries are simplified around a checkpoint-only `imm-autowork`.
- Verification type: automated
- Verification: `bun test tests/imm-autowork-continuation-runtime.test.ts tests/imm-loop-completion-gate.test.ts tests/imm-loop-review-orchestration-contract.test.ts tests/plugin-package-runtime.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-03-001-fix-autorun-boundary-simplification-plan.md --json && python3 -c "from pathlib import Path; checks=[('plugins/immune-brain/dist/imm-autowork.md',['checkpoint runtime','must not invoke executor','must not invoke QA'],['user-facing host loop','can_auto_advance']),('plugins/immune-brain/dist/imm-loop.md',['consumes imm-autowork snapshots','awaiting_execution_input'],[]),('plugins/immune-brain/dist/registry.yaml',['imm-autowork','checkpoint'],['Auto-advance validated workflow steps'])]; [(_ for _ in ()).throw(SystemExit(f'{p}: missing={[s for s in req if s not in Path(p).read_text()]} banned={[s for s in ban if s in Path(p).read_text()]}')) for p,req,ban in checks if any(s not in Path(p).read_text() for s in req) or any(s in Path(p).read_text() for s in ban)]; print('autorun boundary contract checks passed')"`
- Execution note: test-first
- Test scenarios: Covers autowork checkpoint snapshots for execution, QA, rework, replan, budget, and review gates; Covers loop contract consuming checkpoints instead of asking manual reviewer commands; Covers registry wording making `imm-loop` the user-facing autorun entry and `imm-autowork` a checkpoint helper; Covers package parity for retained command surfaces; Covers absence of `imm-autowork-driver` and runtime default QA pass.
- Discovery cache: plugins/immune-brain/runtime/immune_brain_runtime.ts (`runAutoworkCommand`, `runWorkCommand`, `runReviewCommand`); plugins/immune-brain/dist/imm-autowork.md (checkpoint contract); plugins/immune-brain/dist/imm-loop.md (user-facing autorun contract); plugins/immune-brain/dist/registry.yaml (Skill route visibility); tests/imm-autowork-continuation-runtime.test.ts (checkpoint regression); tests/imm-loop-review-orchestration-contract.test.ts (loop contract regression); docs/solutions/rejected-autowork-driver-default-pass.md (rejected boundary); docs/specs/2026-07-03-autorun-boundary-simplification.spec.md (accepted behavior)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If simplifying active contracts requires breaking the `imm-autowork` command or MCP compatibility, stop and replan instead of deleting the surface silently.
- security_considerations: The change must not grant execution, QA, review, or compounder authority to `imm-autowork`; it only clarifies routing and checkpoint contracts.

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-03-001-fix-autorun-boundary-simplification-plan.md --json`
- Runtime sync: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-03-001-fix-autorun-boundary-simplification-plan.md --sync`

## Notes

- This is intentionally a one-step outcome plan because the user asked for a one-shot improvement plan and the outcome is one cohesive contract simplification.
- Deleting or renaming `imm-autowork` can be a later deprecation Plan only after compatible host usage and package surfaces are migrated.
