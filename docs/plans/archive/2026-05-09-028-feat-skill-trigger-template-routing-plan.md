---
title: feat: add skill trigger template routing
type: feat
status: planned
date: 2026-05-09
origin: user requested an imm-planner design for direct skill trigger templates
---

# Iteration Plan

## Task
- Summary: Add a repo-local routing contract for four direct skill trigger templates covering framing, planning, parallel review, and execution continuation
- Origin: The user asked for an `imm-planner` design that makes four trigger templates directly reusable: unclear requests route to `imm-brainstorm`, clear requests route to `imm-planner`, parallel review routes through `imm-code-review` plus conditional `security-reviewer`, and execution continuation routes to `imm-work`.
- Research: Checked `IMMUNE.md`, `README.md`, `.imm/specs/workflow-trigger-repair.spec.md`, `.imm/specs/workflow-friction-reduction.spec.md`, `docs/solutions/workflow-trigger-contracts.md`, `docs/solutions/role-entrypoint-contract-separation.md`, and the skill contracts for `imm-code-review`, `security-reviewer`, and `imm-work`. Conclusion: the repo already has the right individual boundaries and trigger-only patterns, but it lacks one dedicated planning slice that turns those boundaries into a compact user-facing routing contract.
- Decisions: D1 choose `Hold Scope` because the requested template set is already stable and does not require a generic classifier; D2 keep the slice repo-local to spec, README/skill wording, and focused contract verification rather than inventing runtime dispatch; D3 treat `imm-code-review` as the default broad parallel review path and keep `security-reviewer` conditional on explicit security-sensitive trigger evidence; D4 keep `imm-work` as the only default continue entry after a validated plan, preserving role-versus-entrypoint separation.
- Assumptions: The user wants a reusable routing design, not immediate runtime automation; current skill boundaries are already the source of truth and only need a shared template contract plus alignment; focused contract checks are sufficient to guard the first version without building a new router harness.
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/skill-trigger-template-routing.spec.md`, `README.md`, `skills/imm-brainstorm/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-code-review/SKILL.md`, `skills/security-reviewer/SKILL.md`, `skills/imm-work/SKILL.md`, `tests/test_skill_contracts.py`
  - dependencies_known: true
  - verification_path:
      - target: the four trigger templates route to the intended skill surfaces without collapsing authority boundaries or making `security-reviewer` a default reviewer
      - method: planning artifacts plus focused contract regression and manual README/skill wording inspection
  - blockers: none, as long as the slice stays on routing truth and does not expand into runtime classification or automatic reviewer orchestration
  - replan_condition: if execution starts requiring a generic intent classifier, shared reviewer dispatcher, new workflow state fields, or automatic multi-skill fan-out, stop and return to `imm-preplan-review`

## Steps

### Step 1
- Step ID: U1
- Result: The repo has one dedicated spec for the four direct trigger templates
- Verification: `.imm/specs/skill-trigger-template-routing.spec.md` exists as the single source of truth for the template routing contract.
- Test scenarios: Covers template routing truth; Covers conditional security review trigger; Covers continue-entry preservation
- Depends on: none
- Scope: `.imm/specs/skill-trigger-template-routing.spec.md`
- Replan condition: If the template contract cannot be expressed without inventing a generic classifier or changing role authority, stop and return to preplan.

### Step 2
- Step ID: U2
- Result: README publishes the shared trigger-template routing truth for end users
- Verification: `README.md` describes the four trigger templates without contradicting the spec or collapsing conditional review boundaries.
- Test scenarios: Covers brainstorm-versus-planner routing; Covers broad review versus security-specific review; Covers `imm-work` continue entry wording
- Depends on: 1
- Scope: `README.md`
- Replan condition: If alignment starts requiring global workflow rewrites, new roles, or non-local runtime changes, keep the contract narrow and replan the broader workflow work separately.

### Step 3
- Step ID: U3
- Result: The affected skill contracts align to the shared trigger-template contract
- Verification: `skills/imm-brainstorm/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-code-review/SKILL.md`, `skills/security-reviewer/SKILL.md`, and `skills/imm-work/SKILL.md` describe the same route boundaries and defaults as the spec.
- Test scenarios: Covers brainstorm-versus-planner routing; Covers security-reviewer conditional posture; Covers `imm-work` continue entry wording
- Depends on: 2
- Scope: `skills/imm-brainstorm/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-code-review/SKILL.md`, `skills/security-reviewer/SKILL.md`, `skills/imm-work/SKILL.md`
- Replan condition: If alignment requires rewriting role authority or adding new workflow stages, stop and return to preplan.

### Step 4
- Step ID: U4
- Result: Focused verification guards the trigger-template contract against future drift
- Verification: `tests/test_skill_contracts.py` or an equivalent focused check proves the template mapping, conditional `security-reviewer` posture, and `imm-work` continue-entry rule remain truthful.
- Test scenarios: Covers explicit conditional trigger for `security-reviewer`; Covers no-plan fallback to `imm-planner`; Covers validated-plan continuation to `imm-work`
- Depends on: 3
- Scope: `tests/test_skill_contracts.py` and only supporting wording needed for traceability in spec or README
- Replan condition: If truthful verification requires a new router harness or end-to-end runtime automation, keep verification contract-level and replan broader automation separately.

## Notes
- This slice defines reusable trigger templates; it does not build the automation engine that may consume them later.
- Keep `security-reviewer` narrow and evidence-driven; do not let “parallel review” become a pretext for default security fan-out.
- Preserve the existing workflow guard: no implementation continues past planning without entering `imm-work`.
