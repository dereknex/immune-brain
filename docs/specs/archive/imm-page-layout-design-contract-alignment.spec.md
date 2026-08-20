# Spec: Imm Page Layout Design Contract Alignment

**Task ID**: IMM-PAGE-LAYOUT-CONTRACT-002
**Owner**: Planner
**Status**: Proposed

## 1. Goal

Align the page layout design skill surface with Immune-Brain naming and target-project design contract rules.

The skill formerly exposed as `page-layout-design` must be exposed as `imm-page-layout-design`, matching the main Immune-Brain skill prefix pattern. Its output artifact remains `layout_design`, matching Immune-Brain's short result-style artifact naming pattern (`ui_review`, `code_review`, `qa_decision`, `follow_up`). When a target project root contains `DESIGN.md`, both `imm-page-layout-design` and `imm-ui-review` must treat that file as the project-specific design source of truth.

## 2. Context & Boundaries

- `imm-page-layout-design` is a pre-implementation advisory Skill. It defines layout, information hierarchy, action placement, responsive behavior, and verification cues before implementation.
- `imm-ui-review` is a post-implementation advisory reviewer. It reviews UI, UX, accessibility, responsiveness, and visual consistency.
- The target project's root `DESIGN.md` is the highest-priority design contract when present.
- Missing `DESIGN.md` must be reported plainly. The skills may continue with style-neutral checks, but must not invent a house style or create a fallback design file.
- This slice updates Skill contracts, registry metadata, user-facing docs, and contract tests only. It does not implement UI, create design files, or change runtime execution semantics.

## 3. Requirements

### R1. Root `DESIGN.md` Precedence

- `imm-page-layout-design` must explicitly look for the target project root `DESIGN.md` before defining layout.
- `imm-ui-review` must explicitly look for the target project root `DESIGN.md` before applying fallback heuristics.
- When present, findings and layout decisions should reference project-specific design principles, tokens, component constraints, or named rules from that file.
- When absent, output must state that the design contract is missing and remain style-neutral.

### R2. Artifact Stability

- Preserve the `imm-page-layout-design` output artifact as `layout_design`.
- Do not reintroduce the retired `page_layout_contract` artifact name.
- Preserve existing fields inside the artifact shape unless a field becomes misleading. The artifact should still include page type, primary intent, reduction decisions, section map, information regions, operation regions, typography/spacing rules, responsive rules, state coverage, verification cues, and open questions.

### R2b. Skill Surface Rename

- Rename the skill surface from `page-layout-design` to `imm-page-layout-design`.
- Replace current user-facing, registry, loader, and packaged references to the old skill name.
- Remove the old `plugins/immune-brain/skills/page-layout-design/SKILL.md` source shim and old `plugins/immune-brain/dist/page-layout-design.md` packaged contract.

### R3. Read-Only Boundary Preservation

- `imm-page-layout-design` remains code-free and does not write CSS, components, tests, plans, workflow state, or `DESIGN.md`.
- `imm-ui-review` remains read-only and does not create `DESIGN.md`, fallback style files, or UI edits.
- Missing design contract behavior must not revive the rejected pattern of auto-generating `DESIGN.md` or applying a default SaaS style.

### R4. Contract Surface Synchronization

- Update both skill registry copies for the renamed skill surface and stable artifact.
- Update README, user manual, and skill guide references.
- Update focused contract tests to enforce the new skill name, stable artifact name, old surface removal, and root `DESIGN.md` precedence.

## 4. Acceptance Criteria

- `plugins/immune-brain/dist/imm-page-layout-design.md` names `layout_design` as the output artifact and requires target project root `DESIGN.md` precedence.
- `plugins/immune-brain/dist/imm-ui-review.md` explicitly says the target project root `DESIGN.md` is the highest-priority UI contract.
- `plugins/immune-brain/skills/registry.yaml` and `plugins/immune-brain/dist/registry.yaml` list `output_artifacts: [layout_design]` for `imm-page-layout-design`.
- README, `docs/user_manual.md`, and `docs/reference/immune-brain-skills-guide.md` present `imm-page-layout-design` as the current skill name.
- The old source shim `plugins/immune-brain/skills/page-layout-design/SKILL.md` and old packaged contract `plugins/immune-brain/dist/page-layout-design.md` are absent.
- Focused contract tests reject `page-layout-design` and `page_layout_contract` drift and verify root `DESIGN.md` precedence.
- `python3 -m unittest tests.test_skill_contracts` passes.
