---
title: "feat: align ui review to design contract"
type: feat
status: proposed
date: 2026-05-25
origin: user clarified that imm-ui-review stays read-only, missing DESIGN.md only triggers a reminder, and no default style may be imposed
---

# Iteration Plan

## Task
- Summary: Refine `imm-ui-review` so it enforces project-specific `DESIGN.md` contracts when present, reports missing contracts without writing files, and applies style-neutral anti-slop review guidance.
- Origin: User clarified the previously approved slice: `imm-ui-review` remains a read-only reviewer; missing `DESIGN.md` only triggers a reminder; no default SaaS or substitute design language is allowed.
- Spec: docs/specs/archive/ui-review-design-contract-alignment.spec.md
- Brainstorm manifest: BR-REQ-001, BR-REQ-002, BR-REQ-003, BR-REQ-004, BR-REQ-005, BR-DEC-001, BR-DEC-002, BR-DEC-003, BR-OUT-001, BR-Q-001

## Research
- `CONTEXT.md` defines `Skill`, `Plan`, `Spec`, and the reviewer boundary vocabulary that this slice must preserve.
- `plugins/immune-brain/dist/imm-ui-review.md` is the compiled host contract that currently owns UI review checkpoints and dispatch rules.
- `docs/reference/ux-heuristic-checklist.md` demonstrates the thin-index checklist pattern already used by `imm-ui-review`.
- `docs/solutions/project-specific-reviewer-contract-slices.md` reinforces that project-specific reviewers should remain advisory and read-only rather than growing write authority or default-product policy.
- `tests/test_skill_contracts.py` is the correct regression surface for compiled skill contract assertions and drift detection.

## Decisions
- D1: Treat the target project's `DESIGN.md` as the UI review SSOT when it exists.
- D2: When `DESIGN.md` is missing, `imm-ui-review` only reports the absence and recommends adding a design contract; it does not write files or invent a fallback style.
- D3: Anti-slop guidance remains style-neutral quality discipline and must not prescribe default SaaS patterns, components, or page templates.
- D4: Reuse the existing thin-index pattern by adding a reference checklist instead of embedding the entire policy only inside host prose.
- D5: Preserve all existing dispatch, orchestration, translation, and heuristic-review contracts while adding focused regression coverage for the new boundary.

## Assumptions
- Target projects can still receive a useful UI review when `DESIGN.md` is absent, but the result must clearly state that project-specific design guidance is missing.
- A reusable reference checklist plus focused contract tests is sufficient for this slice; no runtime changes are required.

## Scope Mode
- Two-step project-specific reviewer contract slice.

## Engineering Closure Check
- architecture_surface: `docs/reference/`, `plugins/immune-brain/dist/imm-ui-review.md`, `tests/test_skill_contracts.py`
- dependencies_known: yes; plan validator and focused unittest coverage are already present in repo
- verification_path: `python3 .imm/imm-plan.py docs/plans/2026-05-25-001-feat-ui-review-design-contract-alignment-plan.md --json` plus step-local checks
- blockers: none
- replan_condition: if implementation reveals this slice requires runtime behavior outside reviewer contract and regression surfaces

## Brainstorm Manifest
| ID | Item |
| ---- | ---- |
| BR-REQ-001 | `imm-ui-review` remains a read-only reviewer |
| BR-REQ-002 | `DESIGN.md` is enforced as the project-specific design contract when present |
| BR-REQ-003 | Missing `DESIGN.md` only triggers a reminder and recommendation |
| BR-REQ-004 | Anti-slop review guidance stays style-neutral |
| BR-REQ-005 | Anti-slop guidance cannot override a project's own design language |
| BR-DEC-001 | `DESIGN.md` is the only higher-order project design contract |
| BR-DEC-002 | Reminder-only fallback replaces file generation |
| BR-DEC-003 | No default style or substitute design language is allowed |
| BR-OUT-001 | No file-writing runtime or reviewer authority expansion |
| BR-Q-001 | User resolved the open wording question by requiring style-neutral anti-slop language |

## Brainstorm Trace
| Item | Status | Target | Reason |
| ---- | ---- | ---- | ---- |
| BR-REQ-001 | covered_by_step | U2 | `imm-ui-review` must preserve the read-only reviewer boundary |
| BR-REQ-002 | covered_by_step | U2 | `DESIGN.md` precedence belongs in the host contract and regression coverage |
| BR-REQ-003 | covered_by_step | U2 | Missing `DESIGN.md` becomes reminder-only behavior, never file generation |
| BR-REQ-004 | covered_by_step | U1 | Style-neutral anti-slop guidance is captured in a reusable reference checklist |
| BR-REQ-005 | covered_by_step | U1 | Anti-slop guidance must stay subordinate to project-specific design language |
| BR-DEC-001 | captured_as_decision | D1 | `DESIGN.md` is the only higher-order project design contract |
| BR-DEC-002 | captured_as_decision | D2 | Missing-contract behavior is reminder-only |
| BR-DEC-003 | captured_as_decision | D3 | No default style or substitute design language is allowed |
| BR-OUT-001 | out_of_scope | BR-OUT-001 | No file-writing runtime or reviewer authority expansion belongs in this slice |
| BR-Q-001 | captured_as_decision | D3 | User resolved the open question by requiring style-neutral anti-slop wording |

## Devil's Advocate Audit

### 1. Rollback Resilience
- Risk: Tightening the host contract and regression coverage could accidentally invalidate unrelated `imm-ui-review` dispatch or output-shape behavior.
- Recovery: The slice is isolated to a reference checklist, the compiled host contract, and contract tests. A revert cleanly restores the previous reviewer behavior without data migration or runtime healing.

### 2. Verification Vanity
- Risk: A plan that only greps for `DESIGN.md` or `anti-slop` would prove wording exists but would not catch drift back to auto-generation or default-style fallback.
- Mitigation: Step 2 verification must include focused `tests/test_skill_contracts.py` assertions for read-only behavior, missing-contract reminder language, and absence of auto-generation/default-style instructions. Step 1 verification checks for the actual reference checklist structure rather than a single token.

### 3. Spec Dilution Detection
- Risk: "Anti-slop" could be silently narrowed into a vague wording pass, or expanded back into SaaS-default policy because that is easier to write.
- Mitigation: The spec and checklist explicitly require style-neutral discipline, project-specific precedence, and reminder-only fallback. Any default-SaaS template wording is out of spec and should fail review.

## Steps

### Step 1
- Step ID: U1
- Result: `docs/reference/design-contract-review-checklist.md` review source created
- Verification type: automated
- Verification: `python3 -c "from pathlib import Path; text = Path('docs/reference/design-contract-review-checklist.md').read_text(); assert 'DESIGN.md' in text; assert 'missing design contract' in text.lower(); assert 'default SaaS' not in text; assert 'auto-generate' not in text and 'auto generate' not in text"`
- Test scenarios: Confirm the checklist states `DESIGN.md` precedence, reminder-only missing-contract behavior, and style-neutral anti-slop criteria with no fallback style template language.
- Discovery cache: docs/specs/archive/ui-review-design-contract-alignment.spec.md (accepted contract); docs/reference/ux-heuristic-checklist.md (thin-index pattern precedent); docs/solutions/project-specific-reviewer-contract-slices.md (read-only reviewer precedent)
- failure_behavior: Remove the new checklist and keep the existing host contract unchanged.
- security_considerations: None; this step only adds review guidance documentation.
- Depends on: none

### Step 2
- Step ID: U2
- Result: `imm-ui-review` design-contract review boundary enforced
- Verification type: automated
- Verification: `python3 -m unittest tests.test_skill_contracts && python3 .imm/imm-plan.py docs/plans/2026-05-25-001-feat-ui-review-design-contract-alignment-plan.md --json && rg -n "design-contract-review-checklist.md|DESIGN.md|read-only|missing design contract" plugins/immune-brain/dist/imm-ui-review.md tests/test_skill_contracts.py`
- Test scenarios: Confirm `imm-ui-review` loads the new checklist, treats `DESIGN.md` as the project contract when present, reports missing-contract reminders without writing files, preserves advisory-only boundaries, and regression coverage rejects default-style fallback drift.
- Discovery cache: plugins/immune-brain/dist/imm-ui-review.md (host contract target); tests/test_skill_contracts.py (compiled contract regression surface); docs/reference/design-contract-review-checklist.md (review source consumed by host)
- failure_behavior: Revert the host contract and regression additions together so review behavior and tests stay aligned.
- security_considerations: Preserve the existing read-only reviewer boundary; do not introduce file-writing behavior.
- Depends on: 1

## Notes
- This slice changes reviewer contract text and regression coverage only; it does not introduce runtime mutation behavior.
- The first execution entry after validation and sync should be `imm-work`.
