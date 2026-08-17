---
title: feat: rule-based automatic subagent activation
type: feat
status: closed
date: 2026-05-11
origin: user requested an implementation path for automatic activation scheduling; condensed into deterministic catalog-driven activation under explicit host control
---

# Iteration Plan

## Task
- Summary: Introduce a machine-readable trigger catalog and a deterministic activation-plan module so imm-code-review Phase 2 selects security-reviewer and api-contract-reviewer by rule instead of ad hoc model judgment while preserving advisory boundaries and solo fallback
- Origin: Prior brainstorm outlined phased path A plus B session-scoped rule dispatch without global dispatcher or authority bypass; user asked imm-planner to turn that into a validated iteration plan
- Research: subagent-runtime-mvp and first-wave dispatch protocols are Accepted; workflow-skill-subagent-orchestration spec still lists generic dispatcher as non-goal; system-subagents-design still says no automatic scheduling platform; imm-code-review already hosts Dispatch Protocol with six phases
- Decisions: D1 scope stays session-local and host-bound to imm-code-review with two children only; D2 automation means deterministic rules plus catalog not LLM routing in the first slice; D3 amend orchestration and system subagent specs to carve out allowed rule-engine automation explicitly; D4 implementation lives in repo Python module plus YAML catalog plus skill and contract tests; D5 no changes to imm-work or imm-plan core CLI unless a future plan expands scope
- Assumptions: Golden-table unittest coverage is sufficient for activation_plan correctness; Cursor Task dispatch remains the runtime primitive for delegated children
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/automatic-subagent-activation.spec.md`, `docs/reference/subagent-trigger-catalog.yaml`, `docs/reference/automatic-subagent-activation-policy.md`, `.imm/activation_plan.py`, `skills/imm-code-review/SKILL.md`, `.imm/specs/workflow-skill-subagent-orchestration.spec.md`, `.imm/specs/system-subagents-design.spec.md`, `README.md`, `tests/test_skill_contracts.py`, `tests/test_activation_plan.py`
  - dependencies_known: true
  - verification_path:
      - target: catalog loads activation_plan module produces stable outputs contract tests cover golden rows README links policy doc
      - method: `python3 -m unittest tests.test_activation_plan tests.test_skill_contracts` and `python3 .imm/imm-plan.py docs/plans/2026-05-11-056-feat-automatic-subagent-activation-plan.md --json`
  - blockers: none unless scope creeps into LLM router second-wave reviewers or imm-work hooks
  - replan_condition: if truthful behavior needs a shared registry across hosts or background scheduling stop and return to imm-preplan-review

## Steps

### Step 1
- Step ID: U1
- Result: Automatic activation governance is documented while orchestration plus system specs carve out allowed session rule dispatch versus banned global dispatch
- Verification: `.imm/specs/automatic-subagent-activation.spec.md` lists R1–R5 plus acceptance checklist; `.imm/specs/workflow-skill-subagent-orchestration.spec.md` section 5 non-goals explicitly exempt deterministic catalog-driven activation under host skills; `.imm/specs/system-subagents-design.spec.md` clarifies that session-scoped rule tables are not the banned platform scheduler; `python3 .imm/imm-plan.py docs/plans/2026-05-11-056-feat-automatic-subagent-activation-plan.md --json` exits zero after this step updates land
- Agent Hint: imm-planner
- Test scenarios: Covers new spec presence; Covers orchestration carve-out text; Covers system-subagents carve-out text
- Depends on: none
- Scope: `.imm/specs/automatic-subagent-activation.spec.md`, `.imm/specs/workflow-skill-subagent-orchestration.spec.md`, `.imm/specs/system-subagents-design.spec.md`
- Replan condition: If carve-outs weaken imm-work or imm-qa authority revert wording and stop

### Step 2
- Step ID: U2
- Result: Trigger catalog plus activation policy reference define structured inputs plus activation_plan schema for hosts
- Verification: `docs/reference/subagent-trigger-catalog.yaml` exists with imm-code-review host entries for security-reviewer and api-contract-reviewer triggers path globs or keywords align SKILL.md surfaces; `docs/reference/automatic-subagent-activation-policy.md` defines activation_plan fields split_gate overlap with workflow orchestration spec and points to automatic-subagent-activation spec
- Agent Hint: imm-executor
- Test scenarios: Covers catalog file parseable load; Covers policy doc schema narrative
- Depends on: 1
- Scope: `docs/reference/subagent-trigger-catalog.yaml`, `docs/reference/automatic-subagent-activation-policy.md`
- Replan condition: If SKILL.md triggers cannot be expressed without LLM classification narrow catalog to path-only rules

### Step 3
- Step ID: U3
- Result: Pure activation_plan module maps structured inputs to child lists with golden unittest coverage
- Verification: `.imm/activation_plan.py` exports a deterministic builder used only for planning outputs no side effects; `tests/test_activation_plan.py` contains table cases for security-only api-only both neither paths; `python3 -m unittest tests.test_activation_plan` exits zero
- Agent Hint: imm-executor
- Test scenarios: Covers security trigger path; Covers api trigger path; Covers dual trigger; Covers empty fallback
- Depends on: 2
- Scope: `.imm/activation_plan.py`, `tests/test_activation_plan.py`
- Replan condition: If catalog logic duplicates orchestration split_gate pull shared enums only inside this slice’s module boundaries

### Step 4
- Step ID: U4
- Result: imm-code-review skill README plus contract tests bind Phase 2 to catalog-driven activation_plan without expanding hosts or children
- Verification: `skills/imm-code-review/SKILL.md` Phase 2 states default order consult `activation_plan` from `.imm/activation_plan.py` inputs described in automatic-subagent-activation-policy; `README.md` links policy plus catalog; `tests/test_skill_contracts.py` asserts new strings and spec references; `python3 -m unittest tests.test_skill_contracts` exits zero
- Agent Hint: imm-qa
- Test scenarios: Covers imm-code-review dispatch wording; Covers README linkage; Covers contract regression suite
- Depends on: 3
- Scope: `skills/imm-code-review/SKILL.md`, `README.md`, `tests/test_skill_contracts.py`
- Replan condition: If contract tests force LLM hooks keep tests prose-level only and file follow-up plan for runtime harness

## Notes
- Second-wave reviewers and imm-party imm-ui-review catalog wiring are explicitly out of scope for closure of this plan
- LLM-assisted routing stays non-goal until a separate preplan approves it
