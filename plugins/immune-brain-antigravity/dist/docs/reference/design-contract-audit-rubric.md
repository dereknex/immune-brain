# Design Contract Audit Rubric

Use this rubric to audit a project's `DESIGN.md` for completeness, internal
consistency, accessibility specification, and machine-readability. The rubric
uses Vercel Geist (`design.md` / `design.dark.md`) as a structural reference for
what a well-formed, agent-consumable design contract contains — not as a required
style or aesthetic to adopt.

This document is the **audit side**: it evaluates whether a `DESIGN.md` is itself
a good contract. The separate `design-contract-review-checklist.md` is the
**consumer side**: it tells reviewers to treat `DESIGN.md` as the authority when
reviewing rendered UI.

## Scope

- This rubric is read-only and advisory. It does not write, scaffold, or modify
  any project file.
- It checks whether the project's **own declared choices** are complete and
  machine-consumable. It does not require a project to adopt Geist's specific
  values.
- Geist is a structural reference for which dimensions a design contract should
  cover and how tokens should be expressed — never a style authority that
  overrides project decisions.

## Audit Dimensions

### 1. Structural Coverage

Does the `DESIGN.md` cover the core sections an implementation agent needs?
Check for the presence of:

- Overview / design philosophy
- Colors (semantic palette)
- Typography (font families, sizes, weights, line-heights)
- Layout and spacing
- Elevation and depth
- Motion and animation
- Shapes and radii
- Components (buttons, inputs, common controls)
- Voice and content guidelines
- Do's and Don'ts or usage rules

A missing section is a gap finding; it is not a failure if the project
intentionally omits a section and documents why.

### 2. Color-Scale Semantics

- Are color tokens organized by **intent** (background, border, text, accent,
  state) rather than only by raw lightness?
- Does the palette define steps or roles that carry semantic meaning (for
  example, `100` = default background, `700` = solid fill)?
- Are accent colors mapped to state or function (error, warning, success, info,
  link, focus)?
- Is contrast information referenced or WCAG compliance noted?

### 3. Light/Dark Token Parity

- If the project supports multiple themes (light/dark), do both themes use the
  **same token names** with different values?
- Can an agent consume one token vocabulary that works across themes without
  conditional branching on theme names?
- Are both themes documented in the same structure (or a parallel file with the
  same heading layout)?

### 4. Typography Tokens

- Are typography choices expressed as **named tokens** with concrete values
  (`fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`) rather than prose
  descriptions alone?
- Are categories distinguished (headings, body/copy, labels, buttons, code/mono)?
- Do tokens cover the full range of sizes the project uses?
- Are font families specified (not only implied)?

### 5. Spacing/Layout Rhythm

- Is there a defined spacing scale (for example 4px base with named steps)?
- Are layout rules concrete: max content width, breakpoints, padding
  conventions, responsive behavior?
- Can an agent derive correct spacing from the contract without guessing?

### 6. Elevation/Shape

- Are shadow values expressed as concrete `box-shadow` tokens (or equivalent)
  rather than qualitative labels?
- Are border-radius values defined per context (controls, cards, modals, pills)?
- Is the elevation hierarchy clear (flat → raised → popover → modal)?

### 7. Motion

- Are animation durations, easing curves, and allowed motion types specified?
- Is `prefers-reduced-motion` handling documented?
- Does the contract distinguish functional motion (reveals, transitions) from
  decorative motion, and discourage the latter?

### 8. Component Tokens

- Are primary interactive components (buttons, inputs, selects, toggles)
  described with token-level detail: background, text color, border, height,
  radius, padding?
- Are interaction states covered: default, hover, active, focus, disabled, error?
- Is the focus ring or focus indicator specified?

### 9. Accessibility

- Does the contract specify minimum contrast ratios (for example WCAG AA 4.5:1
  for body text)?
- Is focus visibility required for all interactive elements?
- Does the contract prohibit signaling state with color alone (requiring icon or
  text pairing)?
- Are touch targets / minimum sizes referenced for mobile?

### 10. Voice/Content

- Does the contract include content rules: capitalization conventions, action
  labeling, error message format, empty-state copy, in-progress wording?
- Are the rules concrete enough that an agent can apply them without subjective
  judgment?

### 11. Machine-Readability

- Are design decisions expressed as **named tokens with concrete values** that an
  implementation agent can directly consume?
- Or are decisions expressed only as qualitative prose (for example "use generous
  whitespace") that requires interpretation?
- Can the contract be parsed section-by-section by an agent without resolving
  ambiguity?

## Severity

- **Gap**: A section or dimension is entirely absent.
- **Weak**: A section exists but gives only qualitative prose without
  machine-consumable token values.
- **Inconsistency**: Two parts of the contract contradict each other (for
  example, a radius value in Components differs from the Shapes section).
- **Parity drift**: Light and dark themes define different token sets or
  miss entries in one theme.
- **Accessibility gap**: The contract omits minimum contrast, focus visibility,
  or color-only signaling rules.

## Guardrails

- This rubric is read-only. Route fixes through normal follow-up handoff paths
  rather than modifying the project `DESIGN.md` during an audit.
- Do not impose Geist's specific palette, radii, spacing, font choices, or
  aesthetic on the audited project.
- Do not treat a missing `DESIGN.md` as a rubric failure; report the absence and
  recommend authoring one.
- Keep findings style-neutral: critique completeness and consumability, not
  taste.
