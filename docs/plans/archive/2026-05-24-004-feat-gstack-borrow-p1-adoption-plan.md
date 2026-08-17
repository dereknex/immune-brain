---
title: "feat: adopt gstack P1 skill governance insights"
type: feat
status: proposed
date: 2026-05-24
origin: user asked to create a plan from docs/solutions/gstack-skills-borrow-insights.md
---

# Iteration Plan

## Task
- Summary: Turn the P1 conclusions from the gstack borrow Learning into lightweight repository guidance and contract guards.
- Origin: `docs/solutions/gstack-skills-borrow-insights.md` classifies template drift rules, preferred Skill routing, and evidence-backed Learning as P1, while deferring runtime-heavy browser and security infrastructure.
- Spec: docs/specs/gstack-borrow-p1-adoption.spec.md
- Research: `CONTEXT.md` defines Plan, Spec, Step, Skill, Learning, and Activation Plan. `README.md` already states that long-term knowledge lives in `docs/solutions/` and that gstack patterns should be borrowed without importing the full team model. `docs/reference/immune-brain-skills-guide.md` and `docs/reference/workflow-and-subagents.md` are the current reference surfaces for Skill usage and workflow routing. `docs/solutions/rejected-pro-workflow-sqlite-wiki-authority.md` and `docs/solutions/rejected-shared-registry-generic-dispatcher.md` preserve the rejected memory-plane and routing-registry boundaries.
- Decisions:
    - D1: Treat the evidence-backed Learning itself as already complete; this Plan only promotes its P1 conclusions into reference guidance and guards.
    - D2: Add a docs-only generated Skill artifact contract before any template compiler exists.
    - D3: Keep routing hints host-bound and trigger-only; do not introduce a shared registry or LLM-only router.
    - D4: Guard the rejected and deferred boundaries explicitly so later execution cannot silently expand into browser daemon, Canary Token, ONNX, or duplicate memory work.
- Assumptions:
    - A single reference guidance document can carry both generated-artifact rules and routing hints without becoming a new runtime authority.
    - Existing `tests/test_skill_contracts.py` is the appropriate place for focused text-contract guards if implementation needs regression coverage.
    - No upstream gstack code needs to be read again unless execution finds a specific contradiction in the existing Learning.
- Scope Mode: Three-step docs and contract slice
- Engineering Closure Check:
  - architecture_surface: docs/reference guidance, README/reference routing pointers, tests/test_skill_contracts.py
  - dependencies_known: yes; Python standard library and repo-local grep checks are sufficient
  - verification_path: focused rg checks, unittest contract checks, and `python3 .imm/imm-plan.py docs/plans/2026-05-24-004-feat-gstack-borrow-p1-adoption-plan.md --json`
  - blockers: If existing reference docs already contain an equivalent routing table or generated-artifact contract, update that surface instead of creating a duplicate authority.
  - replan_condition: If execution requires runtime changes, new template generation tooling, browser infrastructure, security classifier work, or Activation Plan semantic changes.

## Steps

### Step 1
- Step ID: U1
- Result: Generated Skill artifact contract is documented
- Verification type: automated
- Verification: `test -f docs/reference/gstack-borrow-p1-guidance.md && rg -n "Generated Skill Contract|source_template|generated_output|baseline_ref|allowed_tools|source template|regenerate" docs/reference/gstack-borrow-p1-guidance.md`
- Test scenarios: Confirm future generated Skill artifacts have a source-template-first contract, narrow allowed-tools guidance, BASELINE alignment, and no compiler commitment.
- Discovery cache: docs/solutions/gstack-skills-borrow-insights.md (P1 template drift rules); docs/specs/gstack-borrow-p1-adoption.spec.md (accepted behavior); skills/BASELINE.md (shared Skill behavior); skills/registry.yaml (current Skill metadata)
- failure_behavior: If a better existing reference surface is found, place the contract there and keep `docs/reference/gstack-borrow-p1-guidance.md` as a redirect or omit it with the verification updated during replan.
- security_considerations: Generated metadata must not broaden tool grants or hide prompt-injection-sensitive instructions.
- Depends on: none

### Step 2
- Step ID: U2
- Result: Preferred Skill routing hints are visible
- Verification type: automated
- Verification: `rg -n "Preferred Skill routing|imm-brainstorm|imm-planner|imm-work|imm-code-review|imm-ui-review|docs-verifier|prompt-contract-reviewer|host-bound|trigger-only" README.md docs/reference/gstack-borrow-p1-guidance.md docs/reference/immune-brain-skills-guide.md`
- Test scenarios: Confirm common user intents map to existing Immune-Brain Skill entry points without adding shared registry, generic dispatcher, or LLM-only classifier wording.
- Discovery cache: README.md (user-facing workflow map); docs/reference/immune-brain-skills-guide.md (Skill catalog); docs/reference/workflow-and-subagents.md (workflow and subagent routing); docs/reference/subagent-trigger-catalog.yaml (trigger-only advisory surfaces)
- failure_behavior: If README becomes too crowded, keep the table in reference docs and add only a short README pointer.
- security_considerations: Routing hints must not imply advisory reviewers gain write or QA authority.
- Depends on: 1

### Step 3
- Step ID: U3
- Result: P1 borrow guidance is guarded against drift
- Verification type: automated
- Verification: `python3 -m unittest tests.test_skill_contracts && python3 .imm/imm-plan.py docs/plans/2026-05-24-004-feat-gstack-borrow-p1-adoption-plan.md --json && rg -n "gstack-skills-borrow-insights|rejected-shared-registry-generic-dispatcher|rejected-pro-workflow-sqlite-wiki-authority|No browser daemon|No ONNX|No Canary|No duplicate memory" docs/reference/gstack-borrow-p1-guidance.md tests/test_skill_contracts.py`
- Test scenarios: Confirm contract tests or focused guards cover the Learning trace, rejected memory plane, rejected shared registry, and deferred runtime infrastructure.
- Discovery cache: tests/test_skill_contracts.py (focused text-contract guards); docs/solutions/rejected-pro-workflow-sqlite-wiki-authority.md (memory boundary); docs/solutions/rejected-shared-registry-generic-dispatcher.md (routing boundary); .imm/imm-plan.py (Plan validator)
- Execution note: test-first
- failure_behavior: If full unittest coverage is too broad for the slice, add a focused test case under `tests/test_skill_contracts.py` and keep the final command scoped to that file.
- security_considerations: The guard must preserve the rule that untrusted-output security runtime work requires a separate threat-modeled Plan.
- Depends on: 2

## Notes
- This Plan intentionally implements only the P1 portion of `docs/solutions/gstack-skills-borrow-insights.md`.
- Accessibility Ref, browser daemon, Canary Token, and ONNX classifier remain future P2/P3 candidates that need separate Specs.
- The first execution entry after validation should be `imm-work`, not direct implementation from planner.
