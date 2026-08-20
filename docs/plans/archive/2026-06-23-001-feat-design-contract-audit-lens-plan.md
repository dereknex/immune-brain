---
title: "feat: add design-contract audit lens"
type: feat
status: proposed
date: 2026-06-23
origin: imm-brainstorm framing - user confirmed lens + Geist rubric direction
---

# Iteration Plan

## Task

- Summary: Add a read-only `design_contract` advisory lens plus a style-neutral authoring/audit rubric so a project `DESIGN.md` can be audited for completeness, light/dark parity, accessibility specs, and machine-readability, using Vercel Geist as a structural reference rather than a mandated style.
- Spec: docs/specs/archive/design-contract-audit-lens.spec.md
- Origin: User asked to add review of `DESIGN.md` documents using `https://vercel.com/design.md` and `https://vercel.com/design.dark.md` as templates, and to evaluate whether a new skill is needed. Brainstorm recommended a lens + rubric over a new skill; user confirmed with `确认`.
- Brainstorm manifest: BR-REQ-001; BR-DEC-001; BR-DEC-002; BR-DEC-003; BR-OUT-001; BR-OUT-002; BR-OUT-003; BR-DEFER-001
- Research: `docs/reference/design-contract-review-checklist.md` (and its dist mirror) already encodes the consumer-side contract for `imm-ui-review` (use `DESIGN.md` as authority, remind when missing) but has no authoring/audit-side rubric. `plugins/immune-brain/dist/imm-advisory-reviewer.md` defines the lens vocabulary (`security`, `api_contract`, `data_integrity`, `reliability`, `ui_a11y`, `ui_responsive`, `ui_i18n`, `ux_heuristic`, `ui_visual`) in both `Required inputs` and `Lens Behavior`. The `ui_i18n` lens + `docs/reference/i18n-review-checklist.md` (plus dist mirror) is the closest precedent for shipping a lens together with a reference checklist. Skill full text lives in `plugins/immune-brain/dist/*.md`; `skills/*/SKILL.md` are thin loaders; `tests/test_skill_contracts.py` reads dist via `compiled_skill_content`. `README.md` lines 536-539 hold the advisory lens roster. `docs/solutions/rejected-ui-review-fallback-design-generation.md` rejects auto-generating `DESIGN.md` and default-SaaS fallback; `docs/solutions/project-specific-reviewer-contract-slices.md` prescribes docs-first, explicit-trigger, read-only, focused-regression reviewer slices. The 2026-06-22 document-language policy sets persisted document prose to English by default.
- Decisions: D1 Ship as a `design_contract` advisory lens on `imm-advisory-reviewer`, not a new standalone skill. D2 Vercel Geist is a structural reference for coverage and machine-readability, never a mandated style. D3 Author a new audit-side rubric reference doc, kept distinct from the existing consumer-side `design-contract-review-checklist.md`. D4 Keep the lens explicit-trigger only; do not add it to automatic activation `candidate_lenses` or conditional-risk auto-dispatch. D5 No runtime, schema, or activation-plan changes. D6 New Spec/Plan prose is English per the 2026-06-22 document-language policy.
- Assumptions: `tests/test_skill_contracts.py` is the right home for focused contract regression. No edits to `.imm/` runtime or `current_iteration.json` schema are needed. The reference doc dual-location pattern (`docs/reference/` + `plugins/immune-brain/dist/docs/reference/`) is sufficient for packaged parity.
- Scope Mode: Hold Scope
- Planner research dispatch: solo; single-domain contract + reference-doc + test slice with direct local evidence.

## Output Language

- Human-readable prose: English for new Spec and Plan documents; Chinese for user-facing replies in this workspace
- Preserved literals: file paths, commands, schema fields, enum values, API names, code identifiers, and `CONTEXT.md` canonical terms

## Brainstorm Manifest

| ID | Item |
|----|------|
| BR-REQ-001 | Add a capability to audit a project `DESIGN.md` for completeness, consistency, accessibility specs, and machine-readability, using Vercel Geist as a reference template. |
| BR-DEC-001 | Implement as a `design_contract` advisory lens on `imm-advisory-reviewer` plus a rubric reference doc; do not create a new standalone skill. |
| BR-DEC-002 | Treat Vercel Geist (`design.md` + `design.dark.md`) as a structural rubric/reference, not a mandated house style. |
| BR-DEC-003 | Keep the audit rubric distinct from the existing consumer-side `design-contract-review-checklist.md`. |
| BR-OUT-001 | Do not auto-generate, scaffold, rewrite, or synthesize any project `DESIGN.md`. |
| BR-OUT-002 | Do not impose a default style (for example "clean SaaS" or Geist's aesthetic) as a fallback contract. |
| BR-OUT-003 | Do not add `design_contract` to automatic activation `candidate_lenses` / conditional-risk auto-dispatch; explicit-trigger only. |
| BR-DEFER-001 | Any future automatic activation or auto-dispatch wiring of the lens is deferred to a later Plan if demand appears. |

## Brainstorm Trace

| Item | Status | Target | Reason |
|------|--------|--------|--------|
| BR-REQ-001 | covered_by_step | U1 | U1 authors the audit rubric covering the dimensions; U2 wires the lens that applies it. |
| BR-DEC-001 | covered_by_step | U2 | U2 adds the `design_contract` lens to `imm-advisory-reviewer`; no new skill is created. |
| BR-DEC-002 | covered_by_step | U1 | U1 rubric states Geist is a structural reference and forbids requiring its specific values. |
| BR-DEC-003 | covered_by_step | U1 | U1 rubric is a new audit-side document and U2 regression asserts distinctness from the consumer-side checklist. |
| BR-OUT-001 | covered_by_step | U1 | U1 rubric encodes read-only / no auto-generate; U2 regression guards the negative assertion. |
| BR-OUT-002 | covered_by_step | U1 | U1 rubric forbids default-style fallback; regression asserts no default-SaaS / no Geist-aesthetic mandate. |
| BR-OUT-003 | covered_by_step | U2 | U2 documents explicit-trigger only and regression guards absence from automatic `candidate_lenses`. |
| BR-DEFER-001 | captured_as_decision | D4 | Automatic activation wiring is explicitly deferred; this Plan keeps the lens explicit-trigger only. |

## Devil's Advocate Audit

1. **Rollback Resilience**: Changes are confined to one new rubric reference doc (source + dist mirror), the `imm-advisory-reviewer` dist content, one `README.md` roster line, the Spec, this Plan, and new `tests/test_skill_contracts.py` methods. Rollback is reverting these files; there is no State Ledger, schema, or activation-plan migration to unwind.
2. **Verification Vanity**: A test that only asserts the literal string `design_contract` exists would be vanity. Each step's verification must assert the rubric actually covers the audit dimensions (structure, color-scale semantics, light/dark parity, typography tokens, motion + reduced-motion, accessibility/contrast, component states, machine-readability) AND the negative boundaries (no auto-generate, no default-style fallback, Geist as reference not authority), plus that the lens is documented as explicit-trigger and absent from automatic `candidate_lenses`. These can fail on a real regression.
3. **Spec Dilution Detection**: The two user requirements are (a) audit `DESIGN.md` using Geist as template and (b) decide whether a new skill is needed. The dilution risks are silently turning Geist into a mandated style (re-litigating the rejected default-style boundary) or silently spawning a heavy new skill. Both are recorded as explicit decisions (D1, D2) and guarded by regression, so neither requirement is dropped or narrowed without a recorded mapping.

## Planning Quality Gate

- contract surface: `docs/reference/design-contract-audit-rubric.md`, `plugins/immune-brain/dist/docs/reference/design-contract-audit-rubric.md`, `plugins/immune-brain/dist/imm-advisory-reviewer.md`, `README.md`, `docs/specs/archive/design-contract-audit-lens.spec.md`, this Plan, `tests/test_skill_contracts.py`.
- compatibility: additive lens vocabulary entry and new reference doc; no change to Plan schema, State Ledger schema, MCP tool schema, automatic activation candidate set, or existing lens behavior.
- interruption recovery: each Step is independently re-verifiable via focused unittest; partial application leaves prior lenses and the consumer-side checklist intact.
- rollback path: revert the new rubric doc (both copies), the advisory-reviewer dist edit, the README roster line, and the new tests; no data migration.
- verification strength: focused `tests/test_skill_contracts.py` assertions with positive coverage and negative boundary checks, plus `imm-plan --json`; not human reading alone.
- Brainstorm traceability: every `BR-*` item is mapped in `Brainstorm Trace`; no open `BR-Q-*` remains.

## Steps

### Step 1

- Step ID: U1
- Result: A style-neutral design-contract audit rubric reference document is published in the source tree plus its dist mirror
- Verification type: automated
- Verification: `python3 -m unittest tests.test_skill_contracts.SkillContractTests.test_design_contract_audit_rubric_is_documented && python3 .imm/imm-plan.py docs/plans/2026-06-23-001-feat-design-contract-audit-lens-plan.md --json`
- Test scenarios: Covers required audit dimensions (structural coverage, color-scale semantics, light/dark token parity, typography tokens, spacing/layout rhythm, elevation/shape, motion plus `prefers-reduced-motion`, component tokens and states, accessibility/contrast, voice/content, machine-readability); Covers Geist documented as structural reference not style authority; Covers read-only and no auto-generate of `DESIGN.md`; Covers no default-style fallback; Covers source and dist copies stay in parity; Covers the audit rubric is distinct from the consumer-side `design-contract-review-checklist.md`.
- Discovery cache: docs/reference/i18n-review-checklist.md (precedent reference-doc shape); docs/reference/design-contract-review-checklist.md (consumer-side contract to stay distinct from); docs/solutions/rejected-ui-review-fallback-design-generation.md (rejected boundaries); plugins/immune-brain/dist/docs/reference/i18n-review-checklist.md (dist mirror precedent); tests/test_skill_contracts.py (focused contract assertions)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If any rubric dimension would read as mandating Geist's specific values, reword it as a check on the project's own declared choices; do not weaken the no-auto-generate or no-default-style boundaries to make wording easier.
- security_considerations: No secrets or auth involved; the only risk is scope creep from quality audit into style authorship, which the read-only and no-generate wording prevents.

### Step 2

- Step ID: U2
- Result: The `design_contract` advisory lens is documented as an explicit-trigger read-only reviewer capability
- Verification type: automated
- Verification: `python3 -m unittest tests.test_skill_contracts.SkillContractTests.test_design_contract_lens_is_documented_and_bounded tests.test_skill_contracts.SkillContractTests.test_design_contract_audit_rubric_is_documented && python3 .imm/imm-plan.py docs/plans/2026-06-23-001-feat-design-contract-audit-lens-plan.md --json`
- Test scenarios: Covers `design_contract` added to `imm-advisory-reviewer` `Required inputs` lens list and `Lens Behavior`; Covers the lens entry references the audit rubric doc; Covers the lens documented as read-only with no `DESIGN.md` generation; Covers explicit-trigger posture and absence from automatic activation `candidate_lenses`; Covers `README.md` reviewer roster lists the lens with its explicit trigger; Covers the lens stays distinct from the consumer-side UI-review checklist.
- Discovery cache: plugins/immune-brain/dist/imm-advisory-reviewer.md (lens vocabulary and behavior); README.md (advisory lens roster lines 536-539); docs/reference/automatic-subagent-activation-policy.md (candidate_lenses surface to stay out of); docs/solutions/project-specific-reviewer-contract-slices.md (explicit-trigger read-only slice pattern); tests/test_skill_contracts.py (focused contract assertions)
- Agent Hint: imm-executor
- Depends on: 1
- failure_behavior: If wiring the lens appears to require touching `activation_plan.py` or the automatic candidate set, stop and keep the lens explicit-trigger only; do not expand into runtime activation in this slice.
- security_considerations: Keeping the lens explicit-trigger and read-only prevents unreviewed auto-dispatch and preserves the advisory-only authority boundary.

## Validation

- Plan validator: `python3 .imm/imm-plan.py docs/plans/2026-06-23-001-feat-design-contract-audit-lens-plan.md --json`
- Runtime sync: `python3 .imm/imm-plan.py docs/plans/2026-06-23-001-feat-design-contract-audit-lens-plan.md --sync`

## Notes

- This slice is docs-and-contract first: a new audit-side rubric plus an explicit-trigger advisory lens. It deliberately avoids new skills, runtime activation changes, and any `DESIGN.md` authorship.
- The rubric reference doc is named `design-contract-audit-rubric.md` to stay clearly distinct from the existing consumer-side `design-contract-review-checklist.md`.
- After validation and runtime sync, continue through `imm-work` to activate Step 1.
