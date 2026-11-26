# Design Contract Review Checklist

This checklist gives the `design-review` Skill and the `imm-ui-review` role one
project-specific, read-only review source for design-contract enforcement,
whole-page composition, implementation hygiene, and style-neutral anti-slop
review.

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

## 3. Whole-Page Composition and State Co-location

Judge the assembled page, not each component in isolation. An approved
`DESIGN.md` rule overrides any default below.

- **One visual axis**: headings, content, and actions share a unified visual axis
  and alignment grid across sections; a block that drifts off the axis needs a
  stated reason.
- **One border grammar**: separators and containers use a single `1px` border
  grammar. Report stray `2px` or black rules, and empty states drawn as
  upload-slot `border-dashed` boxes where nothing can be dropped.
- **One spacing owner**: the parent `gap-*` (or the platform equivalent) owns
  spacing between siblings. Children do not stack outer `mt-*` / `mb-*`
  margins on top of it. An optical alignment offset of `<= 6px` is exempt.
- **State with action**: co-locate an empty state and its conversion or next
  action in one container, so explanation and action are read together.
- **Restrained accent**: secondary panels do not use large accent fills; accent
  marks the primary action, current selection, or a status that needs attention.

## 4. Implementation Hygiene and Token Convergence

Apply these to the code and documents in the reviewed surface and its direct
neighbors.

- **Contract budget**: warn when `DESIGN.md` exceeds 40 KB, and report a
  truncation risk when it exceeds 46,080 B, because a single read stops there and
  later rules are silently lost.
- **Duplication**: report duplicated Tailwind class strings and constants across
  branches of one module and across adjacent pages; one named variant, component,
  or constant owns each repeated value.
- **Semantic tokens**: styling uses the project's semantic tokens. Report raw
  hex or OKLCH values, legacy classes, and one-off values that duplicate a token.
- **Dead copy**: report dead i18n keys that no source references after the change,
  checking dynamically composed keys before calling a key unused.
- **Stale documentation**: report stale frontend package names, paths, or
  libraries that `AGENTS.md` or `DESIGN.md` still describe.

## 5. Style-Neutral Anti-Slop Checks

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

## 6. Guardrails

- These checks are quality heuristics, not a substitute style system.
- Do not impose a preset product baseline, default component taxonomy, or
  substitute design language when the project has not defined one.
- Keep the review advisory and read-only; route fixes through normal follow-up
  handoff paths instead of mutating project files.
