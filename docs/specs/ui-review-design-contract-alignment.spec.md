# Spec: UI Review Design Contract Alignment & Read-Only Anti-Slop Upgrade

**Task ID**: IMM-UI-REV-ALIGN-001  
**Owner**: Planner  
**Status**: Approved  

## 1. Goal
Upgrade the `imm-ui-review` skill from a generalized heuristic checker to an adaptive design contract reviewer. The review must dynamically resolve and enforce the target project's `DESIGN.md` as the single source of truth (SSOT) when present. It must also apply style-neutral anti-slop review discipline that reduces chaotic AI layouts, visual noise, and demo-like page quality without imposing a default visual style.

## 2. Context & Boundaries
- **Project-Specific Alignment**: If the target project defines visual rules, components, or tokens in its root `DESIGN.md`, the review MUST adapt to and strictly enforce those guidelines. 
- **Missing Contract Reminder**: If `DESIGN.md` is absent, the review reports the missing project-specific design contract and recommends adding one. It MUST NOT generate, initialize, or write any fallback design file.
- **Read-Only / Non-Destructive**: The review remains strictly advisory, generating structured findings (`findings` P0-P3) and routing rework via `follow_up` handoffs to `imm-work`.
- **No Default Style**: The review MUST NOT impose a default SaaS style, default component taxonomy, or substitute design language when the project has not defined one.
- **Contract Integrity**: Do not violate existing regression assertions inside `tests/test_skill_contracts.py` (e.g., matching exact phrasing like `"Lens/subagent overrides beat host overrides"`).

## 3. Requirements

### R1. Target Project `DESIGN.md` Resolution & Adaptive Checklist
- **Preflight Check Integration**: The skill must inspect the target project root for `DESIGN.md` (or equivalent design spec).
- **Dynamic Policy Enforcement**:
  - If `DESIGN.md` exists, extract visual tokens, custom layouts, colors, and button usage constraints, and enforce them as a hard contract. 
  - If `DESIGN.md` does not exist, report that the project-specific design contract is missing, explain that review can continue only with generic quality heuristics, and recommend authoring `DESIGN.md`. No file creation or mutation is allowed.

### R2. Style-Neutral Anti-Slop Review Checklist
The host review checkpoint suite must be updated to enforce the following strict criteria:
1. **Information Architecture Prioritization**: Check if page objectives, primary actions, core information, and progressive disclosure boundaries (e.g. details pushed to Drawer or Tabs) are explicitly prioritized before generating code.
2. **Intentional Layout Discipline**: Ensure the layout expresses a clear content hierarchy and does not scatter primary information across decorative containers or arbitrary regions.
3. **Primary Action Clarity**: Verify the main action is visually and behaviorally unambiguous, and that competing high-emphasis actions are justified.
4. **Visual Hierarchy & Contrast**: Verify typography, spacing, and contrast remain coherent and do not introduce noisy emphasis stacks or unreadable priority conflicts.
5. **No Unjustified Decoration**: Reject decorative gradients, colorful badges, oversized icons, redundant borders, and novelty styling unless explicitly supported by the project's own design contract.
6. **Project Pattern Consistency**: Verify components and visual patterns are internally consistent with the project rather than assembled as unrelated showcase pieces.
7. **Error Prevention & State Clarity**: Inputs and interactions must show validation, disabled, loading, empty, and error states where applicable.
8. **Responsive & Legible Spacing**: Spacing, padding, and alignment must preserve readability and orientation across supported viewports.
9. **Progressive Disclosure**: Secondary details and advanced controls should not crowd the primary path when they can be progressively revealed.
10. **Product-Grade Cohesion**: The UI must feel intentionally composed for the product's own design language, not like an AI-generated demo or style mashup.

### R3. Safe Integration & Contract Compliance
- Ensure `plugins/immune-brain/dist/imm-ui-review.md` keeps all core orchestration rules, specialist dispatch interfaces, translation (`ui_i18n`), and UX heuristic lenses.
- Add focused regression coverage in `tests/test_skill_contracts.py` for `DESIGN.md` precedence, missing-contract reminder behavior, read-only boundary preservation, and absence of auto-generation/default-style instructions.
- Retain existing verified keywords inside `tests/test_skill_contracts.py`.

## 4. Acceptance Criteria
- `/Users/derek/workspaces/agent-skills/plugins/immune-brain/dist/imm-ui-review.md` is updated to integrate dynamic `DESIGN.md` resolution, missing-contract reminder behavior, and a style-neutral anti-slop checklist while remaining read-only.
- A reusable review checklist source is added under `docs/reference/` so the anti-slop guidance is not embedded only in host prose.
- `tests/test_skill_contracts.py` contains focused assertions that reject auto-generation or default-style fallback drift.
- All skill regression tests in `tests/test_skill_contracts.py` pass successfully without syntax errors.
