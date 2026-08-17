---
name: imm-ui-review
description: Use when reviewing UI.
---

# Immune-Brain: UI Review

This skill adheres to the **[BASELINE.md](BASELINE.md)**.

## Core Responsibilities

- **Accessibility and quality depth**: When you need a structured a11y or cross-topic checklist beyond this skill's checkpoints, use installed local reference material such as `docs/reference/agent-quality-checklists.md` when available and only load optional checklists when the review warrants that depth.
- **Dedicated UI Pass**: Review interface work for accessibility, responsive layout, interaction behavior, and visual consistency.
- **Project-specific design contract review**: When the target project root defines `DESIGN.md`, treat it as the highest-priority UI contract. When it is absent, report the missing design contract and continue with read-only heuristics instead of inventing a substitute style.
- **UX and Heuristic Usability**: Support high-fidelity UX and Usability Heuristic evaluations by dynamically tailor-loading checkpoints from the thin index at `docs/reference/ux-heuristic-checklist.md` depending on the change surface.
- **i18n and Localization Usability**: Support i18n/L10n review through the `ui_i18n` advisory lens by dynamically loading `docs/reference/i18n-review-checklist.md` when the change touches locale resources, translation APIs, RTL behavior, localized assets, or hardcoded user-facing text.
- **Evidence-Backed Findings**: Produce prioritized findings (p0-p3) for immediate fix vs deferred polish.
- **Issue Routing**: Route fixes to `imm-executor` or `imm-pr-fix`; route scope failures to `imm-qa` or `imm-planner`. Subjective UI/UX debates are arbitrated by the QA coordinator (`imm-qa` stage) during final step verification.

## Preflight Checks

1. **Scope check**: Confirm step has a concrete UI output. If not, say the UI review is deferred because the active step is outside UI scope.
2. **Evidence baseline**: Identify changed routes/files. Prepare at least one screenshot and reproduction path.
3. **Design contract check**: Look for the target project root `DESIGN.md`. If it exists, load it before applying generic heuristics and cite its rules in findings when applicable. If it does not exist, report the missing design contract, load `docs/reference/design-contract-review-checklist.md`, and keep the review read-only.
4. **Page design artifact check**: If a pre-implementation `page_design` artifact is available, load it as the audit reference before judging visual elements, theme, motion, and layout. If no `page_design` artifact is available, state that gap and continue with generic UI evidence instead of inventing one.
5. **Impeccable CLI**: Use `npx impeccable detect` if available; otherwise, fall back to manual evidence-based review.

## Shared Dispatch Protocol

Follow the shared [`review-host-dispatch-protocol.md`](docs/reference/review-host-dispatch-protocol.md)
and [`subagent-dispatch-protocol.md`](docs/reference/subagent-dispatch-protocol.md).
Those documents own environment detection, activation policy, authorization,
packet construction, retry/fallback, and result synthesis. Authorization follows
[`subagent-dispatch-protocol.md#authorization-authority`](subagent-dispatch-protocol.md#authorization-authority).

`imm-ui-review` owns the host UI checkpoints and may activate bounded
accessibility, responsive, i18n, visual, design-contract, or UX heuristic
specialists. Build one shared context and one focus delta per specialist. The
host checkpoint always runs even when specialist dispatch degrades; preserve
attribution and the fallback reason in the `ui_review` artifact.

## Workflow Rules

- **Minimal Execution**: Read task boundary, select 3 checkpoints, run lightweight checks, and capture traceable evidence.
- **Design Contract Precedence**: Treat the target project root `DESIGN.md` as the UI review SSOT when present. Do not override project rules with a fallback house style, default SaaS baseline, or substitute component taxonomy.
- **Missing Design Contract Handling**: When `DESIGN.md` is absent, report the missing design contract explicitly and continue with style-neutral checks from `docs/reference/design-contract-review-checklist.md`. Do not write files, bootstrap templates, or synthesize a replacement design contract.
- **Style-Neutral Anti-Slop Discipline**: Use `docs/reference/design-contract-review-checklist.md` to catch noisy demo-like composition, unjustified decoration, weak hierarchy, and layout drift without prescribing a default visual language.
- **UX Heuristics & Change Surface Tailoring**: Dynamically tailor checkpoints from `docs/reference/ux-heuristic-checklist.md` based on file type:
  - *Forms & Config inputs*: Verify alignment with pre-implementation `page_design.form_stretching_limits`. Trigger error prevention (Heuristic 5), smart defaults (Heuristic 7), and error recovery guidance (Heuristic 9). Flag inputs stretching unconstrained across wide viewports as P1 violations (Flag inputs stretching unconstrained across wide viewports as P1).
  - *New Routes/Nav / Action Blocks*: Verify alignment with pre-implementation `page_design.operation_regions`. Trigger visual hierarchy (alignment, contrast, whitespace, proximity) and progressive disclosure (Heuristic 4). Check flat buttons; if >= 3 actions are listed flat without collapsing low-frequency operations under `collapsed: true` metadata, flag as P1 violation (if >= 3 actions are listed flat without collapsing low-frequency operations under `collapsed: true` metadata, flag as P1).
  - *Visual & Brand*: Verify alignment with pre-implementation `page_design.visual_palette`. Verify alignment with pre-implementation `page_design.theme`. Verify alignment with pre-implementation `page_design.image_strategy`. Verify alignment with pre-implementation `page_design.aesthetic_genre`. Use severity mapping for declared `page_design` parameter drift: P1 for accessibility, primary path, action hierarchy, form width, or responsive breakage; P2 for visual palette, theme, image strategy, or aesthetic genre drift that does not block use; P3 for minor polish deviations with no usability impact.
  - *Transitions & Interaction*: Verify alignment with pre-implementation `page_design.motion_contract`.
  - *Async Tasks*: Trigger click active states, loading skeletons, and progress visible trackers (Heuristic 1).
  - *Data loading/Empty states*: Trigger skeleton loading, empty state design, and viewport responsive optimization (Heuristic 8).
- **i18n & Theme Change Surface Tailoring**: Dynamically tailor checkpoints from `docs/reference/i18n-review-checklist.md` when changed files or task text reference locale resources, `i18n`/`l10n`, translation APIs such as `t(`, `useTranslation`, `formatMessage`, `Intl.*`, RTL/right-to-left layout, localized assets, or hardcoded user-facing text. Keep deep semantic translation quality review out of scope and focus on UI usability, formatting, layout, theme legibility, and false-positive exclusions.
- **Delegation Packet**: When delegating to specialized subagents (including the `ui_i18n` and `ux_heuristic` advisory lenses), produce a layered delegation packet: one `shared_context_summary` for the UI state (mapping loaded thin indexes such as `docs/reference/i18n-review-checklist.md` and `docs/reference/ux-heuristic-checklist.md`) and one per-agent `focus_delta`.
- **Follow-up Routing**: When a UI finding is a direct same-boundary fix, emit a first-class `follow_up` handoff instead of handing the repair to `imm-planner`. The handoff must include `scope`, `change_goal`, `verification_hint`, and the current checkpoint `changed_files_signature`, plus `origin_review: imm-ui-review`; its Next Action points to `imm-work` so execution can continue from the follow-up artifact. Broader UX redesigns or unprovable boundary changes still require a new follow-up plan.
- **Repair Guidance**: Produce a follow-up handoff when the next loop needs a bounded repair, describing whether the issue fits the current step boundary. Include same-boundary repair guidance for `imm-work`; the planner may internally fall to `append_to_plan` only when append legality is proven.
- **Authority & Arbitration**: Read-only review role. Subjective UI/UX design or severity arguments are signed off and arbitrated exclusively by the QA coordinator (`imm-qa` stage).

## Boundary

- **Allowed**: same shared baseline, plus inspect UI code, screenshots, and test output.
- **Blocked**: same shared baseline, plus UI implementation edits, style edits, creating `DESIGN.md` or any fallback style file, and blocker claims without reproducible evidence.
- **Workflow guard**: same shared baseline, plus route concrete fixes to `imm-executor`/`imm-pr-fix` and closure decisions to `imm-qa`.

## Output artifact

`ui_review` including: `status` in plain language (passes, needs fixes, or can be deferred), `findings` (area, severity, proof, proposed fix), and the next step in plain language. Produce a `follow_up` handoff for bounded same-boundary repairs. The `follow_up` handoff is an independent execution artifact, not a Plan mutation, and includes `scope`, `change_goal`, `verification_hint`, `changed_files_signature`, and `origin_review`.

When UI review dispatch falls back to solo, the `ui_review` output must include `solo_fallback_reason` and `solo_fallback_meaning` so users see both the stable reason code and the plain-language meaning.

## Next Action

Next Action: specify next skill, reason, and user confirmation needs. For direct same-boundary `follow_up` repairs, set the next skill to `imm-work` and state that `imm-work` should consume the pending follow-up artifact.

## Output style

Default user-facing shape: `Status -> Highest-priority findings -> Next step`. Lead with whether the UI passes, needs fixes, or can defer. Keep only the most important 1-3 findings in default output.
