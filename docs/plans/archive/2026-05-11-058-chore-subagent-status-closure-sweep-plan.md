---
title: "chore: subagent status closure sweep and remaining-work backlog"
type: chore
status: closed
date: 2026-05-11
origin: brainstorm audit found metadata lag between implemented subagent artifacts and their spec/plan statuses; user requested remaining tasks be checked and planned
---

# Iteration Plan

## Task
- Summary: Align subagent spec and plan metadata with implementation reality by accepting verified specs and closing finished plans, then produce a structured remaining-work reference document that prioritizes second-wave reviewer slices and deferred items
- Origin: `/imm-brainstorm` audit found all 9 reviewer SKILL.md exist, activation_plan + catalog + dispatch protocol are implemented, 68 tests pass, all 3 dispatch hosts have protocol sections, but 11+ subagent specs still say Proposed and plans 055/056 still say planned
- Research: Checked all subagent-related spec statuses via grep; confirmed `skills/*/SKILL.md` exist for all 9 reviewers; confirmed `activation_plan.py` + `subagent-trigger-catalog.yaml` + `automatic-subagent-activation-policy.md` exist; confirmed `docs/reference/subagent-dispatch-protocol.md` exists and is referenced by `imm-code-review`, `imm-party`, `imm-ui-review`; confirmed `python3 -m unittest tests.test_activation_plan tests.test_skill_contracts` passes with 68 tests; confirmed `subagent-runtime-mvp.spec.md` and `first-wave-subagent-runtime-dispatch.spec.md` are already Accepted while most others lag behind
- Decisions: D1 scope to metadata alignment plus one reference document only; D2 do not implement new reviewer runtime or expand trigger catalog; D3 accept specs only after verifying acceptance criteria against repo artifacts; D4 produce a single remaining-work reference doc rather than multiple plans
- Assumptions: Spec acceptance criteria can be verified from existing artifacts and passing tests without new implementation; plan 055 and 056 step artifacts all exist based on repo inspection; status updates do not require runtime code changes
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: 11+ `.imm/specs/*subagent*` and reviewer runtime specs, `docs/plans/2026-05-11-055*.md`, `docs/plans/2026-05-11-056*.md`, `docs/reference/subagent-remaining-work.md`, `tests/test_skill_contracts.py`, `tests/test_activation_plan.py`
  - dependencies_known: true
  - verification_path:
      - target: verified specs show Accepted with evidence and remaining-work doc exists
      - method: `python3 -m unittest tests.test_skill_contracts tests.test_activation_plan` and manual cross-check of status fields
  - blockers: none
  - replan_condition: if any spec acceptance criteria reveal genuinely missing implementation that was assumed complete, stop and file a targeted fix plan instead of force-accepting

## Steps

### Step 1
- Step ID: U1
- Result: Subagent metadata across specs plus plans truthfully reflects verified implementation state
- Verification: At least 10 subagent-related specs under `.imm/specs/` show `Accepted` with evidence pointers referencing existing artifacts or tests; `docs/plans/2026-05-11-055*.md` and `docs/plans/2026-05-11-056*.md` frontmatter `status` matches their actual completion state; `python3 -m unittest tests.test_skill_contracts tests.test_activation_plan` still passes with no regressions
- Agent Hint: imm-executor
- Test scenarios: Covers spec acceptance criteria verification; Covers plan status alignment; Covers test regression check
- Depends on: none
- Scope: `.imm/specs/automatic-subagent-activation.spec.md`, `.imm/specs/system-subagents-design.spec.md`, `.imm/specs/workflow-skill-subagent-orchestration.spec.md`, `.imm/specs/imm-party-subagent-delegation.spec.md`, `.imm/specs/first-subagent-batch.spec.md`, `.imm/specs/remaining-first-batch-runtime-activation.spec.md`, `.imm/specs/security-reviewer-runtime.spec.md`, `.imm/specs/api-contract-reviewer-runtime.spec.md`, `.imm/specs/prompt-contract-reviewer-runtime.spec.md`, `.imm/specs/ai-eval-planner-runtime.spec.md`, `.imm/specs/docs-verifier-runtime.spec.md`, `docs/plans/2026-05-11-055*.md`, `docs/plans/2026-05-11-056*.md`
- Replan condition: If verifying a spec reveals genuinely missing implementation artifacts, do not force-accept; instead stop and file a targeted fix plan for the gap.

### Step 2
- Step ID: U2
- Result: A prioritized remaining-work reference document lists all outstanding subagent items with current status per entry
- Verification: `docs/reference/subagent-remaining-work.md` exists and covers four categories: second-wave reviewer runtime status and priority, dispatch host catalog expansion candidates, explicitly deferred items, and per-item current state plus suggested next step; `python3 -m unittest tests.test_skill_contracts tests.test_activation_plan` still passes
- Agent Hint: imm-executor
- Test scenarios: Covers remaining-work doc creation; Covers four-category coverage; Covers test regression check
- Depends on: 1
- Scope: `docs/reference/subagent-remaining-work.md`
- Replan condition: If documenting remaining work reveals that accepted specs in U1 were premature, revert those and return to imm-planner.

## Notes
- This plan does not implement new reviewer runtime, does not expand the trigger catalog, and does not modify activation_plan.py or dispatch protocol behavior.
- Second-wave reviewer implementation plans will be created separately after U2 provides the prioritized backlog.
- Plan 057 (inline clarification / preplan demotion) is in progress on a separate track and is not affected by this sweep.
