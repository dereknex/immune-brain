# Spec: Design Contract Audit Lens

**Task ID**: IMM-REVIEW-DESIGN-CONTRACT-001
**Owner**: Planner
**Status**: Proposed

## 1. Goal

Add a read-only capability that audits a project's own `DESIGN.md` design-system
document for completeness, internal consistency, accessibility-spec presence, and
machine-readability, using Vercel Geist (`https://vercel.com/design.md` and
`https://vercel.com/design.dark.md`) as a structural reference for what a
well-formed, agent-consumable design contract contains.

This capability ships as a new `design_contract` advisory lens on
`imm-advisory-reviewer` plus a new authoring/audit rubric reference document. It
does not introduce a new standalone skill, a default gate, or any runtime
activation change.

## 2. Background

The repository already has a `docs/reference/design-contract-review-checklist.md`,
but that document is **consumer-side**: it tells `imm-ui-review` to treat a
project's `DESIGN.md` as the highest-priority authority when reviewing rendered
UI, and to only remind (never generate) when `DESIGN.md` is missing.

There is currently no **authoring/audit-side** capability that evaluates whether a
project's `DESIGN.md` is itself a good, complete, machine-consumable design
contract. When `imm-page-design` later consumes a weak or inconsistent
`DESIGN.md` as its visual source of truth, the weakness propagates into every
generated page. A bounded audit lens closes that gap before consumption.

Vercel Geist is an exemplary machine-readable design system document: it defines
semantic 10-step color scales (intent, not only lightness), wide-gamut (P3)
equivalents, named typography tokens, a spacing/layout rhythm, elevation, motion
with reduced-motion handling, shape/radius rules, per-component token values and
states, voice/content rules, and explicit do's/don'ts. Light and dark themes
share the same token names with different values across two parallel files. This
structure is the rubric for *what dimensions a design contract should cover and
how machine-consumable it should be* — not a mandated aesthetic.

## 3. Requirements

### R1. The audit rubric must be a style-neutral, structure-and-consumability check

- A new reference document defines the dimensions an auditor checks in a target
  `DESIGN.md`: structural coverage, color-scale semantics, light/dark token
  parity, typography tokens, spacing/layout rhythm, elevation/shape, motion plus
  `prefers-reduced-motion`, component tokens and interaction states,
  accessibility and contrast specifications, voice/content rules, and
  machine-readability (named tokens with concrete values, not prose only).
- The rubric audits whether the project's **own** declared choices are complete,
  internally consistent, and consumable. It must not require a project to adopt
  Geist's specific values (colors, radii, spacing, aesthetic).

### R2. The lens must respect the existing rejected boundaries

- The lens stays read-only and advisory. It must not auto-generate, rewrite,
  scaffold, or synthesize a `DESIGN.md`.
- When `DESIGN.md` is missing, the lens reports the gap and recommends authoring
  one; it must not impose a default house style (for example "clean SaaS" or
  Geist's aesthetic) as a fallback contract.
- Geist is documented as a structural reference, never as a style authority that
  overrides project decisions.

### R3. The lens must be explicit-trigger only

- `design_contract` is added to the `imm-advisory-reviewer` lens vocabulary and
  documented with an explicit trigger: auditing or hardening a project's
  `DESIGN.md` design-system contract document.
- The lens must not be added to the automatic activation `candidate_lenses` set
  or treated as a conditional-risk auto-dispatched layer. It activates only when
  a host or user explicitly supplies the lens.

### R4. The capability must stay distinct from the consumer-side checklist

- The new audit rubric is separate from
  `docs/reference/design-contract-review-checklist.md`; the audit-side rubric
  evaluates the `DESIGN.md` document quality, while the existing checklist uses
  `DESIGN.md` as authority during UI review.

### R5. Documentation parity and regression coverage

- Reference documents are mirrored into the packaged copy under
  `plugins/immune-brain/dist/docs/reference/`.
- The reviewer roster in `README.md` lists the new lens with its explicit
  trigger, matching the existing lens roster style.
- Focused contract tests in `tests/test_skill_contracts.py` guard the rubric
  content, the lens contract, the rejected boundaries, and the explicit-trigger
  posture.

## 4. Non-goals

- No new standalone skill (no new `SKILL.md`, no new `registry.yaml` role).
- No runtime change: no edits to `activation_plan.py`, `current_iteration.json`
  schema, MCP tool schema, or auto-dispatch behavior.
- No generation, scaffolding, or rewriting of any project `DESIGN.md`.
- No imposition of Geist's specific visual values as a required style.
- No rewrite of the existing consumer-side `design-contract-review-checklist.md`
  semantics.

## 5. Verification

- `python3 -m unittest tests.test_skill_contracts` passes, including new focused
  assertions for the rubric and the `design_contract` lens.
- `python3 .imm/imm-plan.py docs/plans/2026-06-23-001-feat-design-contract-audit-lens-plan.md --json`
  validates the plan.
