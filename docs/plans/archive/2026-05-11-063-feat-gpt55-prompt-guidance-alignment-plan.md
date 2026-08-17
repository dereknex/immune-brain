---
title: "feat: GPT-5.5 prompt guidance alignment for imm-* skills"
type: feat
status: active
date: 2026-05-11
origin: brainstorm — 对照 OpenAI GPT-5.5 Prompting Guide 识别六项改进点：BASELINE 成功标准重写、Collaboration Posture 块、执行停止循环、preamble 约定、retrieval budget、planner traceability 字段
---

# Iteration Plan

## Task
- Summary: Align imm-* skills with GPT-5.5 prompting guide across three outcome areas: BASELINE success criteria rewrite plus collaboration posture block, execution stop-check loop and preamble convention, and research dispatch retrieval budget plus planner traceability fields
- Origin: User-directed comparison of OpenAI GPT-5.5 Prompting Guide against current skill implementation identifying six improvement gaps across process-orientation, collaboration style, stopping conditions, retrieval budgets, and plan traceability
- Research: BASELINE four principles are process-oriented; no Collaboration Posture block exists; imm-work and imm-executor lack self-evaluating stop-check loops and preamble convention; Research Dispatch sections have trigger conditions but no retrieval budget stopping rule; imm-planner output artifact does not name failure_behavior or security_considerations
- Decisions: D1 three independently closable steps grouped by change surface to allow incremental delivery; D2 BASELINE changes are text rewrites not structural removals; D3 stop-check rule embedded in existing Workflow Rules not a new section; D4 retrieval budget is a stopping-rule addendum to existing dispatch trigger not a replacement; D5 planner traceability fields are optional to preserve backward compatibility
- Assumptions: BASELINE.md and skill SKILL.md files are the only change surface; test_skill_contracts.py can accommodate new contract assertions without breaking existing ones; no Python tooling changes required
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `skills/BASELINE.md`, `skills/imm-work/SKILL.md`, `skills/imm-executor/SKILL.md`, `skills/imm-brainstorm/SKILL.md`, `skills/imm-planner/SKILL.md`, `tests/test_skill_contracts.py`, `.imm/specs/gpt55-prompt-guidance-alignment.spec.md`
  - dependencies_known: true
  - verification_path:
      - target: BASELINE success criteria form and collaboration posture present; imm-work and imm-executor carry stop-check and preamble rules; brainstorm and planner Research Dispatch carry retrieval budget; planner output artifact names failure_behavior and security_considerations; contract tests pass
      - method: `python3 -m unittest tests.test_skill_contracts` and `python3 .imm/imm-plan.py docs/plans/2026-05-11-063-feat-gpt55-prompt-guidance-alignment-plan.md --json`
  - blockers: none
  - replan_condition: if BASELINE rewrite triggers downstream contract test failures that cannot be fixed within the same step scope-expand step 1 to include those skill files

## Steps

### Step 1
- Step ID: U1
- Result: BASELINE Shared Guards carries outcome-oriented success criteria for the four principles plus a Collaboration Posture block covering when to ask versus when to proceed on reasonable assumptions
- Verification: `skills/BASELINE.md` Shared Guards section uses success-criteria framing for all four principles; `skills/BASELINE.md` contains a Collaboration Posture block with at minimum when-to-ask and when-to-proceed-on-assumption rules; `python3 -m unittest tests.test_skill_contracts` exits zero
- Test scenarios: Covers collaboration posture section presence in BASELINE; Covers four-principles success-criteria form text; Covers no regression on existing hub skill anatomy and boundary contract assertions
- Depends on: none
- Scope: `skills/BASELINE.md`, `tests/test_skill_contracts.py`
- Replan condition: If rewriting the four principles requires updating downstream skill contract assertions beyond what fits in this step scope-expand to include those skill files

### Step 2
- Step ID: U2
- Result: imm-work plus imm-executor each carry a stop-check self-evaluation rule in Workflow Rules plus a preamble convention for multi-step tool chains
- Verification: `skills/imm-work/SKILL.md` Workflow Rules contains a stop-check rule stating when to evaluate whether current step evidence is sufficient to close; `skills/imm-executor/SKILL.md` Workflow Rules contains equivalent self-evaluation stop rule; both skills contain a preamble convention stating that multi-step or tool-heavy tasks should emit a visible user update acknowledging the request and naming the first step before starting execution; `python3 -m unittest tests.test_skill_contracts` exits zero
- Test scenarios: Covers imm-work stop-check text presence; Covers imm-executor stop-check text presence; Covers imm-work preamble convention text; Covers imm-executor preamble convention text
- Depends on: none
- Scope: `skills/imm-work/SKILL.md`, `skills/imm-executor/SKILL.md`, `tests/test_skill_contracts.py`
- Replan condition: If stop-check rule creates ambiguity with existing verification-first principle clarify that stop-check applies at loop boundaries not within a single tool call

### Step 3
- Step ID: U3
- Result: brainstorm plus planner Research Dispatch sections carry explicit retrieval budget stopping rules while planner output artifact lists failure_behavior plus security_considerations as optional fields
- Verification: `skills/imm-brainstorm/SKILL.md` Research Dispatch section contains a retrieval budget rule stating to stop dispatching when existing evidence is sufficient to answer the core framing question; `skills/imm-planner/SKILL.md` Research Dispatch section contains equivalent retrieval budget stopping rule; `skills/imm-planner/SKILL.md` Output artifact section lists failure_behavior and security_considerations as optional fields; `python3 -m unittest tests.test_skill_contracts` exits zero
- Test scenarios: Covers brainstorm retrieval budget text presence; Covers planner retrieval budget text presence; Covers planner output artifact failure_behavior field text; Covers planner output artifact security_considerations field text
- Depends on: none
- Scope: `skills/imm-brainstorm/SKILL.md`, `skills/imm-planner/SKILL.md`, `tests/test_skill_contracts.py`
- Replan condition: If retrieval budget rule conflicts with existing multi-domain trigger condition adjust to clarify budget operates after trigger not instead of trigger

## Notes
- All three steps are independent and can proceed in any order
- Each step touches only skill text and contract tests; no Python tooling changes required
- Absolute-rule calibration (softening MUST/NEVER for judgment contexts) is deferred to a follow-up audit slice across all skills
- Phase parameter integration is out of scope pending API integration decisions
