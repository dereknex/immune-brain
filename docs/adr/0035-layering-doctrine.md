# Layering doctrine

Status: accepted; builds on [ADR 0004](0004-dual-host-assurance-adapters.md).

## Context

ADR 0004 fixed one Kernel behind a host-neutral Port and coordinator, with Host adapters on top. The norms that keep that shape were stated only in issue bodies and one sentence in `CONTEXT.md`, so Planner candidates and Lane Executors had no packaged text to follow when they sliced or implemented adapter work.

## Decision

Record four norms as doctrine. Their operational text is [the layering reference](../reference/layering-rules.md); this ADR records why they hold and does not restate them.

1. **Dependency Rule.** Source dependencies point from the outer layer toward the inner one, and adapters neither import nor extend each other.
2. **Port slicing.** Work on a Port is sliced by Port method group, each group with a conformance test, and sequenced seams, then state machines, then packaging.
3. **Mapping convergence.** A concept has one canonical form and one projection per host, produced by subtraction or pointer. A new layer, shared location, or cross-layer dependency needs an ADR before code.
4. **Module documentation.** A module document is structured Interface / Invariants / Side Effects / Verification, and one without a Verification command is incomplete.

The Planner contract, the Executor role prompt, and the drive Execution Loop point at the reference. They apply the rules only when the target repository declares layers.

Enforcement stays with `tests/runtime-layering-boundary.test.ts`, which locks host-to-host import edges to a baseline. This ADR adds no enforcement tool, runtime change, Kernel change, or Port change.

## Consequences

- Layering guidance has one packaged home that ships to every Host package.
- A neutral shared location for adapter code is not named here; choosing and recording it is deferred to its own ADR when that extraction is planned.
- Existing TaskIntents and Specs written before the rule carry no defect for lacking it.
