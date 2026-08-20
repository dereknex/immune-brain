# Spec: UI/UX Heuristic and Experience Review Upgrade

**Task ID**: IMM-UI-UX-REV-001  
**Owner**: Planner  
**Status**: Approved  

## 1. Goal
Upgrade the existing `imm-ui-review` skill to support high-fidelity User Experience (UX) and Usability Heuristic evaluations based on Nielsen's 18+ product heuristics, interaction feedback loops, and visual design guidelines. The system must enforce a structured 10-point checklist prior to final sign-off, routing decisions to the QA stage for final arbitration.

## 2. Context & Boundaries
- **Read-Only**: The UI/UX review remains strictly read-only and advisory-only. It may only output structured findings (`findings` P0-P3) and execution `follow_up` handoffs.
- **Authority Separation**: UX/UI evaluation findings are verified and signed off by the `imm-qa` role, which holds final arbitration authority for step closure.
- **No Heavy CLI Overhead**: No additional heavy CLI dependencies are introduced; manual fallback is preserved.

## 3. Requirements

### R1. Authoritative UX/UI Heuristics Checklist
- **Path**: `docs/reference/ux-heuristic-checklist.md`
- **Content Requirements**:
  - **Nielsen Heuristics**: Direct mapping of the 10 heuristics (System status, Real world, User control, Consistency, Error prevention, Recognition, Flexibility, Aesthetics, Help users recognize/recover, Documentation).
  - **Information Architecture**: Clear categorization, hierarchy, navigation stability, and natural naming.
  - **Feedback First Interactive Loop**: Click states, success notifications, error feedback with recovery guidance, slow load skeletons, and long-task status trackers.
  - **Visual Hierarchy (Visual Principles)**: Alignment, Contrast, Proximity (亲密性), Repetition, Whitespace, and Visual Hierarchy.
  - **Core Product Experience Principles**: Don't Make Me Think, Progressive Disclosure, Recognition over Recall, Feedback First, Error Prevention, Empty State Design, Consistency, Default Smartness, User Control, Less but Better.
  - **10-Point Acceptance Check**: Explicit checklist to be checked page-by-page.

### R2. Progressive Tailoring and Triggers in Host Skill
- Update the `imm-ui-review` host rules so it tailor-loads checkpoints based on the change surface:
  - *Forms and Config inputs*: Trigger error prevention, default smartness, and error recovery guidance.
  - *Async Tasks*: Trigger "Feedback First" loading and progress visible trackers.
  - *New Routes/Nav*: Trigger visual design hierarchy, alignment/contrast, and simple progressive disclosure.
  - *Data loading/Empty states*: Trigger empty state design, skeleton loading, and mobile/desktop responsive optimization.

### R3. Dispatch Integration
- Update the Specialist dispatch framework to allow triggering the specialized `ux_heuristic` advisory lens when large interactive flow/layout changes are met, loading the thin index `ux-heuristic-checklist.md`.

### R4. Sign-Off and Arbitration Contract
- Formally document that subjective UI/UX disagreements are arbitrated by the QA coordinator role (`imm-qa` stage) during the final step verification.

## 4. Acceptance Criteria
- `docs/reference/ux-heuristic-checklist.md` is created with all detailed UI/UX principles, interactive loops, visual principles, and product rules.
- `plugins/immune-brain/dist/imm-ui-review.md` is updated to include the tailored trigger-loading rules and references to `ux-heuristic-checklist.md`.
- All checks in the `test_skill_contracts.py` suite pass cleanly.
