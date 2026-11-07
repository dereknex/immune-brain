# Design Contract Review Checklist

This checklist gives `imm-ui-review` a project-specific, read-only review source
for design-contract enforcement and style-neutral anti-slop review.

## 1. Contract Resolution

- Treat the target project root `DESIGN.md` as the highest-priority visual and
  interaction contract when it exists.
- Apply project-defined tokens, layout rules, components, spacing logic,
  interaction patterns, and visual exceptions before any generic heuristic.
- Do not replace, reinterpret, or soften explicit project design rules with a
  fallback style preference.

## 2. Missing Design Contract

- If `DESIGN.md` is missing, report the missing design contract explicitly in
  the review output.
- State that the review can only apply generic quality heuristics until the
  project-specific contract is authored.
- Recommend adding `DESIGN.md` when the review surface needs stable visual or
  interaction rules.
- Do not write files, bootstrap templates, or synthesize a replacement
  contract.

## 3. Style-Neutral Anti-Slop Checks

- Information hierarchy is intentional: primary goals, core content, and
  secondary details are not competing for the same emphasis.
- Layout structure is coherent: content is grouped predictably and does not
  sprawl across arbitrary cards, panels, or decorative containers.
- Primary actions are clear: the main action is obvious and competing
  high-emphasis actions are justified.
- Visual hierarchy is controlled: typography, spacing, emphasis, and contrast
  work together without noisy stacking or accidental priority conflicts.
- Decoration is justified: gradients, badges, icons, borders, and visual flourishes
  must serve the product's own design language rather than novelty.
- Pattern usage is consistent: components should feel like part of one product,
  not a collage of unrelated demo fragments.
- States are covered: loading, empty, disabled, error, and validation states are
  present where the interface needs them.
- Responsive readability is preserved: spacing and alignment remain legible
  across supported viewport ranges.
- Progressive disclosure is respected: advanced controls and secondary detail do
  not crowd the primary path.
- Product cohesion is visible: the UI should feel intentionally composed for the
  project, not like an AI-generated showcase.

## 4. Guardrails

- These checks are quality heuristics, not a substitute style system.
- Do not impose a preset product baseline, default component taxonomy, or
  substitute design language when the project has not defined one.
- Keep the review advisory and read-only; route fixes through normal follow-up
  handoff paths instead of mutating project files.
