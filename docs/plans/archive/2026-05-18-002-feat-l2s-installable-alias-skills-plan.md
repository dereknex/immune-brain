---
title: "feat: add installable L2S alias skills"
type: feat
status: planned
date: 2026-05-18
origin: user clarified L2S-WF should be installable and run should compose autowork plus code review
---

# Iteration Plan

## Task

- Summary: Make L2S-WF usable as real installable `prep` and `run` skills while preserving Immune-Brain authority separation.
- Origin: User clarified that the completed L2S-WF pattern is not enough because `prep` and `run` are not installed skills; user also corrected `run` to compose `imm-autowork` with `imm-code-review`.
- Spec: docs/specs/archive/l2s-installable-alias-skills.spec.md
- Research: `docs/plans/2026-05-15-009-feat-l2s-workflow-pattern-plan.md` explicitly chose not to create new skills; `docs/specs/archive/l2s-workflow-pattern.spec.md` and `docs/patterns/l2s-workflow.md` define `/prep` and `/run` as instruction aliases; `skills/registry.yaml` has no `prep` or `run`; `scripts/legacy-installer.sh` discovers any `skills/*/SKILL.md` automatically; `tests/test_install_local.py` already checks that `--list` equals the live skill directories; `tests/test_skill_contracts.py` validates registry shape and skill contracts.
- Decisions:
  - D1: Implement `prep` and `run` as thin installable Skill aliases instead of shell commands.
  - D2: Keep `prep` as orchestration over `imm-brainstorm` and `imm-planner`.
  - D3: Define `run` as orchestration over `imm-autowork`, `imm-code-review`, same-boundary follow-up handling, and `imm-compounder`.
  - D4: Do not introduce a shared dispatcher or new authority role.
- Assumptions: Codex skill invocation through installed `SKILL.md` files is the target usage; terminal users should continue using `imm-*` CLI wrappers.
- Scope Mode: Focused implementation
- Engineering Closure Check:
  - architecture_surface: `skills/prep/SKILL.md`, `skills/run/SKILL.md`, `skills/registry.yaml`, `docs/specs/archive/l2s-workflow-pattern.spec.md`, `docs/patterns/l2s-workflow.md`, `IMMUNE.md`, `README.md`, `tests/test_skill_contracts.py`
  - dependencies_known: true
  - verification_path: focused contract tests plus installer list check plus plan validation
  - blockers: none
  - replan_condition: if `prep` or `run` require new runtime command dispatch semantics stop and return to planner

## Steps

### Step 1
- Step ID: U1
- Result: Installable L2S contract
- Verification: `rg -n "installable|skills/prep|skills/run|imm-autowork|imm-code-review" docs/specs/archive/l2s-installable-alias-skills.spec.md docs/specs/archive/l2s-workflow-pattern.spec.md docs/patterns/l2s-workflow.md IMMUNE.md README.md`
- Verification type: automated
- Depends on: none
- Discovery cache: docs/specs/archive/l2s-installable-alias-skills.spec.md (new behavioral contract); docs/patterns/l2s-workflow.md (existing alias pattern); IMMUNE.md (constitution wording)
- Scope: `docs/specs/archive/l2s-workflow-pattern.spec.md`, `docs/patterns/l2s-workflow.md`, `IMMUNE.md`, `README.md`

### Step 2
- Step ID: U2
- Result: L2S alias skill surface
- Verification: `test -f skills/prep/SKILL.md && test -f skills/run/SKILL.md && rg -n "name: prep|name: run|imm-brainstorm|imm-planner|imm-autowork|imm-code-review|imm-compounder" skills/prep/SKILL.md skills/run/SKILL.md skills/registry.yaml`
- Verification type: automated
- Depends on: 1
- Discovery cache: skills/registry.yaml (machine-readable skill registry); scripts/legacy-installer.sh (live skill directory discovery)
- Scope: `skills/prep/SKILL.md`, `skills/run/SKILL.md`, `skills/registry.yaml`

### Step 3
- Step ID: U3
- Result: Alias install verification
- Verification: `python3 -m unittest tests.test_skill_contracts tests.test_install_local && mise run list-skills | rg "^(prep|run)$"`
- Verification type: automated
- Depends on: 2
- Discovery cache: tests/test_skill_contracts.py (registry and contract regression surface); tests/test_install_local.py (installer list behavior)
- Scope: `tests/test_skill_contracts.py`, `tests/test_install_local.py`
