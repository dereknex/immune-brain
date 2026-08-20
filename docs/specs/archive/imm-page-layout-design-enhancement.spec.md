# Spec: Imm Page Layout Design and UI Review Enhancement

**Task ID**: IMM-PAGE-LAYOUT-ENHANCEMENT-001
**Owner**: Planner
**Status**: Proposed

## 1. Goal

Enhance the pre-implementation layout contract (`imm-page-layout-design`) and post-implementation visual review (`imm-ui-review`) skills to establish a tight "Design-Execute-Audit" loop. 
This spec introduces explicit UI/UX constraints on action density (preventing flatly-listed buttons via progressive disclosure/collapsing dropdowns), icon usage, and form stretching limits.

## 2. Context & Boundaries

- `imm-page-layout-design` is a pre-implementation advisory skill. It must now require layout designs to define action hierarchies, collapsing strategies for low-frequency actions, icon semantic anchors, and form stretching thresholds.
- `imm-ui-review` is a post-implementation advisory skill. It must now require reviewers to audit implementations directly against the pre-implementation `layout_design` contract, flagging excessive flat buttons or stretched forms as high-priority (P1) issues.
- `docs/reference/ux-heuristic-checklist.md` acts as the shared heuristic catalog. It will be expanded with explicit rules for progressive disclosure and form layouts.
- **Boundaries**: This change updates skill documentation, heuristics catalogs, and contract tests only. It does not modify actual UI components or change production runtime code.

## 3. Requirements

### R1. Pre-Implementation Action & Layout Constraints (`imm-page-layout-design`)

- Update `plugins/immune-brain/dist/imm-page-layout-design.md`:
  - Require the `layout_design` artifact to explicitly group actions into `visible_actions` (high-frequency, maximum of 2) and `hidden_actions` (low-frequency or destructive, flagged with `collapsed: true` to be hidden behind dropdown or `...` menu).
  - Require layout contracts to define an `icon_semantic_anchors` strategy (e.g. lightweight line-art icons for all visible operations).
  - Require explicit horizontal grid limits (`form_stretching_limits`) to prevent input fields from stretching fully across wide screens (e.g., standard max-width constraint like `max-w-md` or Bento Grid groupings).

### R2. Post-Implementation Alignment Review (`imm-ui-review`)

- Update `plugins/immune-brain/dist/imm-ui-review.md`:
  - Force reviewers to load the pre-implementation `layout_design` contract as audit reference when available.
  - Require the reviewer to flag flat listings of $\ge 3$ buttons or unconstrained inputs stretching across the viewport as P1 UX violations that block QA approval.

### R3. Heuristics Checklist Expansion (`ux-heuristic-checklist.md`)

- Update `docs/reference/ux-heuristic-checklist.md`:
  - Under Section 5 (Core Product Experience Principles) or Section 6 (10-Point Heuristic Acceptance Checklist), add rules:
    - **Action Density/Progressive Disclosure**: High-frequency primary/secondary actions are visible; low-frequency actions must collapse into a sub-action menu.
    - **Form Scaling Defense**: Inputs must not stretch beyond a readable width (max-width recommendation of ~448px) unless grouped into balanced multi-column Bento grids.

### R4. Contract Test Updates (`test_skill_contracts.py`)

- Update `tests/test_skill_contracts.py`:
  - Add assertions verifying that compiled skill contracts for `imm-page-layout-design` and `imm-ui-review` explicitly contain the newly introduced terms (`visible_actions`, `collapsed`, `form_stretching_limits`).

## 4. Acceptance Criteria

- The compiled skill files (`plugins/immune-brain/dist/imm-page-layout-design.md` and `plugins/immune-brain/dist/imm-ui-review.md`) contain updated workflow rules and output schema terms.
- `docs/reference/ux-heuristic-checklist.md` contains the new heuristics for action collapsing and form width limits.
- `tests/test_skill_contracts.py` passes all test cases under `python3 -m unittest tests.test_skill_contracts`.
