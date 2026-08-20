---
title: "feat: core phases adversarial mechanisms hardening"
type: feat
status: proposed
date: 2026-05-25
---

# Iteration Plan

## Task
- Summary: Harden Planner, Executor, and Compounder phases in the Immune-Brain framework through three new adversarial mechanisms: Devil's Advocate preplan audit, YAGNI Red-Line Gate, and Debate & Evidence Critique.
- Origin: User requested to add adversarial mechanisms to Planner, Executor, and Compounder phases.
- Spec: docs/specs/archive/imm-adversarial-mechanisms.spec.md
- Research: `IMMUNE.md` defines the multi-phase workflow. The spec folders and `plugins/immune-brain/dist/` specify the skill instructions.
- Decisions:
    - D1: Solidify adversarial checks directly into `plugins/immune-brain/dist/imm-planner.md`, `imm-executor.md`, and `imm-compounder.md` to force execution.
    - D2: Synchronize outward-facing skill metadata under `skills/` with updated core specifications.
- Assumptions:
    - The added cognitive load in each step is manageable by LLMs and humans.
- Scope Mode: Three-step hardening slice
- Engineering Closure Check:
  - architecture_surface: `plugins/immune-brain/dist/imm-planner.md`, `plugins/immune-brain/dist/imm-executor.md`, `plugins/immune-brain/dist/imm-compounder.md`
  - dependencies_known: yes
  - verification_path: static inspection of modified specifications, schema validations via `imm-plan`
  - blockers: none
  - replan_condition: If schema validation rejects modified rule sets.
- Devil's Advocate Audit:
  - rollback_resilience: Each step edits a small, named skill surface and records changed files through `imm-work`; a failed step can be reverted by restoring only that step's dist/wrapper files before advancing.
  - verification_vanity: The step grep checks prove the named mechanism exists in both core and wrapper text, while full `imm-plan --json` and contract tests catch malformed plan structure or missing cross-skill contract language.
  - spec_dilution_detection: The plan keeps all three requested mechanisms in separate closable steps and preserves the spec's QA/YAGNI and Compounder critique requirements instead of narrowing them to wording-only additions.

## Steps

### Step 1
- Step ID: U1
- Result: Planner specification is hardened with Devil's Advocate preplan audit
- Verification type: automated
- Verification: `grep -q "Devil's Advocate" plugins/immune-brain/dist/imm-planner.md && grep -q "Devil's Advocate" plugins/immune-brain/skills/imm-planner/SKILL.md`
- Test scenarios: Verify the "Devil's Advocate" criteria (rollback resilience, verification vanity, spec dilution detection) are added to the core planner specification and skill.
- Discovery cache: plugins/immune-brain/dist/imm-planner.md (Planner Spec); plugins/immune-brain/skills/imm-planner/SKILL.md (Planner Skill)
- Agent Hint: imm-executor
- failure_behavior: If validation fails, revert changes and re-align grammar.
- security_considerations: Ensure no unauthorized edits leak into adjacent files.
- Depends on: none

### Step 2
- Step ID: U2
- Result: Executor specification is hardened with YAGNI Red-Line Gate
- Verification type: automated
- Verification: `grep -q "YAGNI Red-Line Gate" plugins/immune-brain/dist/imm-executor.md && grep -q "YAGNI Red-Line Gate" plugins/immune-brain/skills/imm-executor/SKILL.md`
- Test scenarios: Verify YAGNI rules (refactoring rejection, future proofing pruning, surgical mapping) are embedded into the executor specifications.
- Discovery cache: plugins/immune-brain/dist/imm-executor.md (Executor Spec); plugins/immune-brain/skills/imm-executor/SKILL.md (Executor Skill)
- Agent Hint: imm-executor
- failure_behavior: If validation fails, revert changes and re-align grammar.
- security_considerations: Make sure surgical mapping remains strict.
- Depends on: 1

### Step 3
- Step ID: U3
- Result: Compounder specification is hardened with Debate & Evidence Critique
- Verification type: automated
- Verification: `grep -q "Debate & Evidence Critique" plugins/immune-brain/dist/imm-compounder.md && grep -q "Debate & Evidence Critique" plugins/immune-brain/skills/imm-compounder/SKILL.md`
- Test scenarios: Verify debate critique triad (falsifiability, evidence trail, architecture entropy resistance) is recorded in the compounder specification.
- Discovery cache: plugins/immune-brain/dist/imm-compounder.md (Compounder Spec); plugins/immune-brain/skills/imm-compounder/SKILL.md (Compounder Skill)
- Agent Hint: imm-executor
- failure_behavior: If validation fails, revert changes and re-align grammar.
- security_considerations: Check ADR suggestions boundary consistency.
- Depends on: 2

## Notes
- Run plan validation to verify. Move forward with imm-work to execute Step 1.
