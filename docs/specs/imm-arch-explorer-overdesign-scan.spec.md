# Functional Spec: imm-arch-explorer Overdesign Scan

## 1. Background

`imm-arch-explorer` already searches for shallow modules, scattered domain
concepts, weak ownership boundaries, coupling evidence, and ADR constraints.
That makes it good at finding places where the architecture needs deepening.

The missing pressure is the reverse direction: architecture can also be too
heavy for the current evidence. Without an explicit overdesign scan, the
explorer can recommend deeper abstraction while missing unused layers,
single-consumer extension points, ceremonial state models, or generic
frameworks that do not yet pay rent.

## 2. Accepted Behavior

The architecture explorer must include an evidence-backed **Overdesign Scan**
inside the existing architecture exploration flow.

The scan must:

1. Look for concrete overdesign signals before treating more abstraction as the
   best recommendation.
2. Treat complexity as acceptable only when there is evidence such as multiple
   real consumers, committed roadmap pressure, ADR constraints, test-backed
   behavior, or clear ownership isolation.
3. Include a simpler alternative in the recommended candidate check without
   creating a new simplified-architecture mode.
4. Keep the explorer read-only. It can recommend simplification candidates, but
   selected work must still route through `imm-planner`.

## 3. Overdesign Signals

The scan should look for at least these evidence patterns:

- **Single-consumer abstraction**: interface, registry, dispatcher, base class,
  adapter, provider, or plugin layer has one real caller or one implementation.
- **Idle extension point**: hook, option, feature flag, state enum, parameter,
  or future branch exists without a committed scenario, behavior test, or ADR.
- **Pass-through layer stack**: multiple modules only forward values without
  owning policy, validation, error handling, security, or domain vocabulary.
- **Premature platformization**: generic host, provider, workflow, or registry
  machinery exists for a single active domain.
- **Ceremonial state model**: lifecycle states or manifests exceed the number
  of distinct behaviors and verification paths.
- **Domain-language erosion**: generic technical names such as manager,
  adapter, orchestrator, provider, or service obscure the project vocabulary in
  `CONTEXT.md`.
- **Structure-only tests**: tests mostly prove that a registry, schema, or field
  exists rather than proving behavior that users or workflow roles depend on.
- **Change-cost mismatch**: small behavior changes require edits across many
  contract, sync, validator, or manifest surfaces.

## 4. Output Contract

`imm-arch-explorer` should surface overdesign findings as candidate evidence,
not as automatic rewrite instructions. A candidate may be a simplification
candidate when the evidence shows the architecture is heavier than the current
behavior needs.

For the recommended selection, the existing Best-Fit Challenge must also ask:

- What is the smallest boring alternative?
- What evidence justifies keeping the current complexity?
- What would make the abstraction worth keeping?

## 5. Non-Goals

- Do not create a separate `imm-simplify-architecture` skill.
- Do not make `imm-arch-explorer` edit code.
- Do not reject all abstraction by default.
- Do not require runtime metrics or a new scanner in this slice.

## 6. Verification Plan

- Contract tests assert that `imm-arch-explorer` documents Overdesign Scan,
  concrete overdesign signals, evidence-backed simplification candidates, and
  the read-only planner handoff.
- Existing plan validation proves this slice remains a normal executable
  Immune-Brain Plan.
