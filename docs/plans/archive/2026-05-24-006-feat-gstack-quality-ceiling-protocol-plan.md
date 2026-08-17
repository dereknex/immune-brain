---
title: "feat: document gstack quality ceiling protocol"
type: feat
status: proposed
date: 2026-05-24
origin: user asked planner to turn the gstack quality philosophy recommendation into the best executable plan for the current implementation
---

# Iteration Plan

## Task
- Summary: Add a lightweight Skill quality ceiling protocol that maps gstack's role preference separation, interaction ritual discipline, and closed-world completeness philosophy onto existing Immune-Brain contracts.
- Origin: User asked how to learn from gstack's "极度的角色偏好分离", "严苛的交互仪式", and "湖水烧干式的完备性哲学" to improve AI quality, then asked for the best plan based on the current implementation.
- Spec: docs/specs/gstack-quality-ceiling-protocol.spec.md
- Research: `CONTEXT.md` defines Skill, Plan, Spec, Step, QA, Compounder, Learning, Activation Plan, and State Ledger vocabulary. `skills/BASELINE.md` already contains Success Criteria, Collaboration Posture, Hub skill anatomy, and Shallow Discovery. `plugins/immune-brain/dist/imm-brainstorm.md`, `plugins/immune-brain/dist/imm-planner.md`, `.imm/imm_core/plan_runtime.py`, and `plugins/immune-brain/dist/imm-qa.md` already implement the closed-world origin coverage chain. `docs/reference/automatic-subagent-activation-policy.md` keeps advisory subagents host-bound, trigger-only, and advisory-only. `docs/reference/gstack-borrow-p1-guidance.md` and `docs/solutions/gstack-skills-borrow-insights.md` preserve the gstack borrow boundaries and deferred runtime candidates. `docs/solutions/rejected-pro-workflow-sqlite-wiki-authority.md` and `docs/solutions/rejected-shared-registry-generic-dispatcher.md` reject duplicate memory and shared dispatcher expansion without stronger evidence.
- Decisions:
    - D1: Treat this as a docs and contract slice, not a runtime or workflow-state change.
    - D2: Add one focused reference guidance document instead of spreading the philosophy across every Skill file first.
    - D3: Express "role preference" as preferred bias plus prohibited drift for the four core authority / hub Skills.
    - D4: Express "interaction ritual" as entry and exit gates aligned with existing BASELINE Success Criteria and Collaboration Posture.
    - D5: Restrict "lake-dry completeness" to closed-world inputs such as Brainstorm manifest and review follow-up packets.
    - D6: Preserve rejected boundaries around shared registry, duplicate memory, browser daemon, Canary Token, and ONNX runtime.
- Assumptions:
    - A reference guidance file under `docs/reference/` is enough to make the protocol reusable before touching every Skill contract.
    - `tests/test_skill_contracts.py` is the right place for focused drift guards because this slice protects prompt and documentation contracts.
    - No `CONTEXT.md` vocabulary update is needed because the plan can use existing canonical terms.
    - Planner research dispatch is not needed because the relevant implementation surfaces are already known and this is a single docs / contract domain slice.
- Scope Mode: Two-step docs and contract slice
- Engineering Closure Check:
  - architecture_surface: docs/reference guidance and prompt contract tests
  - dependencies_known: yes; repo-local text checks and Python unittest are sufficient
  - verification_path: focused `rg` checks, `python3 -m unittest tests.test_skill_contracts`, and `python3 .imm/imm-plan.py docs/plans/2026-05-24-006-feat-gstack-quality-ceiling-protocol-plan.md --json`
  - blockers: If an equivalent quality ceiling guidance already exists during execution, update that surface instead of creating a duplicate reference authority.
  - replan_condition: If execution requires runtime dispatch changes, State Ledger schema changes, generated Skill tooling, browser infrastructure, or untrusted-output security runtime.

## Steps

### Step 1
- Step ID: U1
- Result: Skill quality ceiling guidance is documented
- Verification type: automated
- Verification: `test -f docs/reference/gstack-quality-ceiling-protocol.md && rg -n "Role Preference Contract|preferred bias|prohibited drift|Interaction Ritual Gates|Entry gate|Exit gate|Closed-world Completeness Boundary|Brainstorm manifest|Brainstorm Trace|origin_coverage|QA closure gate" docs/reference/gstack-quality-ceiling-protocol.md`
- Test scenarios: Confirm the guidance maps gstack's three philosophies to the current Immune-Brain roles, keeps rituals as entry and exit gates, and restricts completeness to closed-world inputs.
- Discovery cache: docs/specs/gstack-quality-ceiling-protocol.spec.md (accepted behavior); skills/BASELINE.md (shared success criteria and collaboration posture); docs/reference/gstack-borrow-p1-guidance.md (gstack P1 boundaries); docs/solutions/gstack-skills-borrow-insights.md (source Learning); docs/solutions/contracts.md (origin coverage pattern); plugins/immune-brain/dist/imm-brainstorm.md (Brainstorm manifest source); plugins/immune-brain/dist/imm-planner.md (Brainstorm Trace mapping); plugins/immune-brain/dist/imm-qa.md (closure gate)
- failure_behavior: If the guidance overlaps too much with existing gstack P1 guidance, add a dedicated quality-ceiling section there and update verification during replan.
- security_considerations: The guidance must not imply advisory reviewers, planners, or QA can gain write or closure authority outside their existing boundaries.
- Depends on: none

### Step 2
- Step ID: U2
- Result: Skill quality ceiling protocol is guarded against drift
- Verification type: automated
- Verification: `python3 -m unittest tests.test_skill_contracts && python3 .imm/imm-plan.py docs/plans/2026-05-24-006-feat-gstack-quality-ceiling-protocol-plan.md --json && rg -n "gstack-quality-ceiling-protocol|Role Preference Contract|Entry gate|Exit gate|Closed-world Completeness Boundary|No shared registry|No duplicate memory|No browser daemon|No ONNX|No Canary" tests/test_skill_contracts.py docs/reference/gstack-quality-ceiling-protocol.md`
- Test scenarios: Confirm focused contract guards protect the guidance path, role preference wording, entry and exit gate wording, closed-world completeness boundary, and rejected runtime boundaries.
- Discovery cache: tests/test_skill_contracts.py (contract guard surface); docs/reference/gstack-quality-ceiling-protocol.md (new guidance); docs/solutions/rejected-pro-workflow-sqlite-wiki-authority.md (memory boundary); docs/solutions/rejected-shared-registry-generic-dispatcher.md (routing boundary); .imm/imm-plan.py (Plan validator)
- Execution note: test-first
- failure_behavior: If full unittest coverage exposes unrelated existing failures, keep the focused guard in `tests/test_skill_contracts.py` and report the unrelated failing contracts separately for replan.
- security_considerations: The guard must preserve that Canary Token, ONNX, and other untrusted-output runtime work require a separate threat-modeled Plan.
- Depends on: 1

## Notes
- This Plan intentionally strengthens the quality contract layer without changing runtime behavior.
- Browser daemon, Accessibility Ref runtime, Canary Token, ONNX classifier, shared registry, and duplicate memory remain out of scope.
- The first execution entry after validation should be `imm-work`, not direct implementation from planner.
