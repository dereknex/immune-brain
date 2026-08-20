---
title: "fix(skills): align imm page layout design contract"
type: fix
status: proposed
date: 2026-06-08
origin: imm-brainstorm framing - DESIGN.md precedence and Immune-Brain skill naming alignment
---

# Iteration Plan

## Task

- Summary: Rename `page-layout-design` to `imm-page-layout-design`, keep its `layout_design` artifact stable, and align `imm-page-layout-design` plus `imm-ui-review` with target project root `DESIGN.md` precedence.
- Spec: docs/specs/archive/imm-page-layout-design-contract-alignment.spec.md
- Origin: Brainstorm manifest from 2026-06-08 page layout design / UI review contract alignment.
- Brainstorm manifest: BR-REQ-1; BR-REQ-2; BR-REQ-3; BR-REQ-4; BR-REQ-5; BR-OUT-1; BR-OUT-2; BR-DEC-1; BR-Q-1
- Research: `CONTEXT.md` defines Skill as a role-scoped contract with output artifact and next-action gate, and Plan as an executable Step sequence. The page layout design Skill is a pre-implementation advisory Skill that should use the Immune-Brain `imm-*` skill prefix while continuing to emit the short result artifact `layout_design`. Current repo-facing sync surfaces are the source shim, packaged dist contract, both registry copies, README, `docs/user_manual.md`, `docs/reference/immune-brain-skills-guide.md`, and `tests/test_skill_contracts.py`. Existing `imm-ui-review` already treats `DESIGN.md` as the highest-priority UI contract but should be tightened to say "target project root `DESIGN.md`" so arbitrary nearby or upstream files do not become design authority. `docs/solutions/rejected-ui-review-fallback-design-generation.md` rejects auto-generating `DESIGN.md` or applying default SaaS style when a design contract is missing. `docs/solutions/contracts.md` captures the original skill rollout pattern and identifies the same repo-facing sync surfaces.
- Decisions: D1 use a new one-step Plan because the current State Ledger Plan is closed and this is a distinct Skill contract alignment goal. D2 rename the skill surface to `imm-page-layout-design`, not leave it as `page-layout-design`, because main Immune-Brain skills use the `imm-*` prefix. D3 keep the artifact as `layout_design`, not `page_layout_contract`, because Immune-Brain artifacts are short result names such as `ui_review`, `code_review`, `qa_decision`, and `follow_up`. D4 require target project root `DESIGN.md` precedence for both pre-implementation layout design and post-implementation UI review. D5 preserve missing-contract read-only behavior and explicitly exclude auto-generated design files or default house style.
- Assumptions: The skill rename is a user-facing contract rename, not a runtime data migration, because `imm-page-layout-design` is advisory prose with registry metadata and docs/tests rather than persisted State Ledger data. A focused skill contract test is sufficient verification for this planning slice because no executable UI behavior changes.
- Scope Mode: Hold Scope
- Planner research dispatch: solo; this is a small Skill contract/docs/test slice and local evidence is sufficient.

## Brainstorm Trace

| Item | Status | Target | Reason |
| --- | --- | --- | --- |
| BR-REQ-1 | covered_by_step | U1 | The step updates both skills so target project root `DESIGN.md` is the design authority when present. |
| BR-REQ-2 | covered_by_step | U1 | The step preserves explicit missing-contract reporting and style-neutral fallback behavior. |
| BR-REQ-3 | covered_by_step | U1 | The step makes `imm-page-layout-design` output include design contract source and key constraints. |
| BR-REQ-4 | covered_by_step | U1 | The step keeps `imm-ui-review` findings aligned to root `DESIGN.md` as highest-priority evidence. |
| BR-REQ-5 | covered_by_step | U1 | The step preserves the page layout artifact as `layout_design` and removes retired `page_layout_contract` references. |
| BR-OUT-1 | captured_as_decision | D5 | The plan explicitly excludes auto-generating `DESIGN.md` or fallback style files. |
| BR-OUT-2 | captured_as_decision | D3 | The plan removes `page_layout_contract` as the current artifact name in repo-facing surfaces. |
| BR-DEC-1 | captured_as_decision | D4 | The design contract lookup is rooted at the target project root, not arbitrary nearby or upstream files. |
| BR-Q-1 | resolved_as_assumption | D1 | The brainstorm stated there are no open questions, so the slice is ready to plan. |

## Devil's Advocate Audit

1. **Rollback Resilience**: This slice should touch only the Skill contract docs, registry metadata, user-facing docs, focused tests, this Spec, and this Plan. If the skill rename causes confusion, revert those files together; no runtime state migration or UI implementation rollback is required.
2. **Verification Vanity**: Grepping for a single new token would be too weak. Verification must run `tests.test_skill_contracts` so the Skill content, registry surfaces, README, user manual, and guide assertions fail if the old artifact name or weak `DESIGN.md` wording drifts back.
3. **Spec Dilution Detection**: The accepted scope includes the skill surface rename, stable artifact name, and root `DESIGN.md` precedence. The Plan does not silently narrow to only documentation wording; it requires tests and both registry copies. It also preserves the explicit non-goal of fallback design generation.

## Planning Quality Gate

- contract surface: `plugins/immune-brain/skills/imm-page-layout-design/SKILL.md`, `plugins/immune-brain/dist/imm-page-layout-design.md`, `plugins/immune-brain/dist/imm-ui-review.md`, `plugins/immune-brain/skills/registry.yaml`, `plugins/immune-brain/dist/registry.yaml`, README, `docs/user_manual.md`, `docs/reference/immune-brain-skills-guide.md`, `tests/test_skill_contracts.py`, and `docs/specs/archive/imm-page-layout-design-contract-alignment.spec.md`.
- compatibility: Existing users will see the new skill name in docs and registry. The artifact name and fields remain stable to avoid forcing a larger conceptual migration.
- interruption recovery: If execution stops after partial doc edits, `rg -n "page-layout-design|page_layout_contract|target project root.*DESIGN.md"` and `python3 -m unittest tests.test_skill_contracts` identify the incomplete surface.
- rollback path: Revert the Spec, Plan, Skill docs, registry entries, user docs, and focused test changes together.
- verification strength: Use the focused contract test suite plus Plan validation; no browser or UI screenshot checks are needed because this slice changes Skill contracts, not a rendered interface.
- Brainstorm traceability: Every `BR-*` item from the brainstorm manifest is mapped above.

## Steps

### Step 1

- Step ID: U1
- Result: Imm page layout design contract is aligned
- Verification: `python3 -m unittest tests.test_skill_contracts && python3 .imm/imm-plan.py docs/plans/2026-06-08-003-fix-imm-page-layout-design-contract-alignment-plan.md --json`
- Verification type: automated
- Execution note: characterization-first
- Test scenarios: `imm-page-layout-design` exists and old `page-layout-design` source shim is absent; `imm-page-layout-design` emits `layout_design` and no longer presents `page_layout_contract`; target project root `DESIGN.md` precedence is documented for both `imm-page-layout-design` and `imm-ui-review`; missing `DESIGN.md` remains read-only and style-neutral; both registry copies expose `output_artifacts: [layout_design]`; README, user manual, and skill guide use `imm-page-layout-design`; rejected fallback design generation does not reappear.
- Discovery cache: plugins/immune-brain/skills/imm-page-layout-design/SKILL.md (primary source shim); plugins/immune-brain/dist/imm-page-layout-design.md (primary imm-page-layout-design contract); plugins/immune-brain/dist/imm-ui-review.md (UI review design contract wording); plugins/immune-brain/skills/registry.yaml (source registry artifact); plugins/immune-brain/dist/registry.yaml (packaged registry artifact); README.md (user routing references); docs/user_manual.md (user manual references); docs/reference/immune-brain-skills-guide.md (skill roster and detailed guide); tests/test_skill_contracts.py (focused contract regression); docs/specs/archive/imm-page-layout-design-contract-alignment.spec.md (accepted behavior)
- Depends on: none
- failure_behavior: If focused tests reveal downstream docs or registry surfaces still require the old skill name, keep the rename scoped but update all repo-facing surfaces in the same step rather than splitting a partial migration.
- security_considerations: The design contract lookup must not read or expose unrelated project secrets; it should only use the target project root `DESIGN.md` or report that it is missing.

## Validation

- Plan validator: `python3 .imm/imm-plan.py docs/plans/2026-06-08-003-fix-imm-page-layout-design-contract-alignment-plan.md --json`
- Runtime sync: `python3 .imm/imm-plan.py docs/plans/2026-06-08-003-fix-imm-page-layout-design-contract-alignment-plan.md --sync`

## Notes

- This Plan intentionally does not implement UI or create `DESIGN.md`.
- After validation and runtime sync, continue through `imm-work` for Step 1.
