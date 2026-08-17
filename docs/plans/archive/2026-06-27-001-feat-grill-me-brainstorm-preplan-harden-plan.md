---
title: "feat: harden brainstorm and preplan-review with grill-me patterns"
type: feat
status: proposed
date: 2026-06-27
origin: upstream grill-me skill analysis from mattpocock/skills
---

# Iteration Plan

## Task

- Summary: Add codebase-first rule to `imm-brainstorm` inline narrowing and serial single-question + recommended-answer mechanics to `imm-preplan-review` Relentless Grilling Mode, with contract test coverage for both.
- Spec: docs/specs/grill-me-brainstorm-preplan-harden.spec.md
- Origin: Upstream `grill-me` skill analysis identified two interaction patterns missing from Immune-Brain: (1) codebase-before-human questioning discipline, and (2) serial single-question with recommended-answer format for high-stakes grilling.
- Brainstorm manifest: BR-REQ-001; BR-REQ-002; BR-DEC-001; BR-DEC-002; BR-OUT-001; BR-OUT-002
- Research: `grill-me` SKILL.md (3 paragraphs) defines its core mechanic: "Interview me relentlessly ... walk down each branch of the decision tree ... provide your recommended answer ... ask one at a time ... if a question can be answered by exploring the codebase, explore the codebase instead." `imm-brainstorm` dist defines Inline Narrowing Challenge with scale-adjusted gap probes but no explicit codebase-first gate. `imm-preplan-review` dist defines Relentless Grilling Mode as "decision tree expansion to force resolution" but does not specify serial single-question format, recommended-answer pattern, or one-at-a-time discipline. Existing contrast doc (`mattpocock-skills-contrast.md`) maps `grill-me` to `imm-brainstorm` + `imm-preplan-review`; this Plan operationalizes that mapping. `tests/test_skill_contracts.py` already has `test_preplan_review_has_relentless_grilling_mode` (line 1924) and `test_brainstorm_has_rejected_decision_scan` (line 2345) as the nearest assertion sites; both can be extended with new assertIn lines rather than adding new test methods.
- Decisions: D1 Add the codebase-first rule as a single sentence under Inline Narrowing Challenge, not as a new section. D2 Add the serial Q&A mechanics as a sub-bullet under Relentless Grilling Mode, preserving the existing decision-tree language. D3 Keep the existing scale-adjusted probe count (1-2 lightweight, 3-4 large) exactly as-is. D4 Add contract test assertions to existing test methods rather than creating new test methods, to minimize test surface. D5 Use automated verification instead of manual file reading.
- Assumptions: The two dist files (`imm-brainstorm.md`, `imm-preplan-review.md`) and `tests/test_skill_contracts.py` are the only surfaces that need editing. No runtime, State Ledger, MCP, or registry changes are needed because both skills are read-only declarative instruction files and the edits are additive. The installed plugin cache at `~/.codex/plugins/cache/agent-skills/immune-brain/0.12.3/dist/` is a copy; the canonical source is `plugins/immune-brain/dist/`.

## Output Language

- Human-readable prose: English for Spec and Plan documents
- Preserved literals: file paths, skill names, `CONTEXT.md` canonical terms

## Brainstorm Manifest

| ID | Item |
|----|------|
| BR-REQ-001 | Add "codebase-first" hard rule to `imm-brainstorm` inline narrowing |
| BR-REQ-002 | Introduce serial single-question + recommended-answer grill mode in `imm-preplan-review` |
| BR-DEC-001 | Do not change `imm-brainstorm`'s scale-adjusted probing depth |
| BR-DEC-002 | Do not turn `imm-preplan-review` into a default workflow stage |
| BR-OUT-001 | Do not create a new standalone "grill" skill |
| BR-OUT-002 | Do not change the overall workflow routing |

## Brainstorm Trace

| Item | Status | Target | Reason |
|------|--------|--------|--------|
| BR-REQ-001 | covered_by_step | U1 | U1 adds the codebase-first sentence to the inline narrowing challenge and a contract test assertion. |
| BR-REQ-002 | covered_by_step | U2 | U2 documents serial single-question + recommended-answer under relentless grilling and a contract test assertion. |
| BR-DEC-001 | captured_as_decision | D3 | Scale-adjusted probe depth is preserved; no change to lightweight vs large task count. |
| BR-DEC-002 | captured_as_decision | D2 | Preplan review remains an opt-in high-pressure gate. |
| BR-OUT-001 | out_of_scope | D2 | Grill mechanics are added to existing preplan review; no new skill needed. |
| BR-OUT-002 | out_of_scope | D2 | Workflow routing is unchanged. |

## Devil's Advocate Audit

1. **Rollback Resilience**: Both edits are additive sentences in declarative instruction files plus one assertIn line per test method. Revert the three files and the old behavior is fully restored. No runtime state, State Ledger, MCP surface, or registry is touched.
2. **Verification Vanity**: Each step runs `python3 -m unittest tests.test_skill_contracts` which will fail if the expected text is missing from the dist file. The test also fails if a regression removes the new text later. This is a real feedback loop, not text-exists-only vanity.
3. **Spec Dilution Detection**: No requirement was silently narrowed. Both BR-REQ items are directly covered by the two steps with test assertions. BR-OUT items are explicitly deferred to keep scope tight. The addition of D4 (extend existing tests) and D5 (automated verification) strengthens rather than dilutes the spec.

## Steps

### Step 1

- Step ID: U1
- Result: The `imm-brainstorm` Inline Narrowing Challenge includes an explicit codebase-first rule with contract test coverage
- Verification type: automated
- Verification: `python3 -m unittest tests.test_skill_contracts -k test_brainstorm_has_rejected_decision_scan && python3 -m unittest tests.test_skill_contracts`
- Test scenarios: Codebase-first sentence is present under Inline Narrowing Challenge; scale-adjusted probe count language is unchanged; existing brainstorm tests still pass; contract test assertion exists and passes.
- Discovery cache: plugins/immune-brain/dist/imm-brainstorm.md (edit target); tests/test_skill_contracts.py (test assertion target); upstreams/mattpocock-skills/skills/productivity/grill-me/SKILL.md (reference source)
- Agent Hint: imm-executor

### Step 2

- Step ID: U2
- Result: The `imm-preplan-review` Relentless Grilling Mode documents serial single-question + recommended-answer mechanics with contract test coverage
- Verification type: automated
- Verification: `python3 -m unittest tests.test_skill_contracts -k test_preplan_review_has_relentless_grilling_mode && python3 -m unittest tests.test_skill_contracts`
- Test scenarios: Serial single-question language is present; recommended-answer pattern is documented; existing decision-tree expansion language is preserved; preplan review remains described as an opt-in gate; existing preplan tests still pass.
- Discovery cache: plugins/immune-brain/dist/imm-preplan-review.md (edit target); tests/test_skill_contracts.py (test assertion target); upstreams/mattpocock-skills/skills/productivity/grill-me/SKILL.md (reference source)
- Agent Hint: imm-executor
