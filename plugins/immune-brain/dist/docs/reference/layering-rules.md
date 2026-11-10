# Layering Rules

This reference is the single operational text for four layering norms: the Dependency Rule, Port slicing, mapping convergence, and the module-documentation format. The Planner contract, the Executor role prompt, the drive Execution Loop, ADR 0035, and `CONTEXT.md` point here instead of restating it.

The rules apply when the target repository declares layers: an architecture map, an ADR, or a Port/adapter structure. A repository that declares no layers incurs no finding. Each norm below is stated as a general principle, then instantiated for this repository.

## Dependency Rule

**Principle.** A source dependency points from the outer layer toward the inner one, never the reverse, and a layer never depends on a sibling at the same level. An inner layer states the interface it needs; an outer layer implements it.

**This repository.** Kernel ← Port + coordinator ← host-core ← Adapter ← CLI/host.

- The Kernel owns authority state and depends on no Host.
- The Port and the host-neutral coordinator under `plugins/immune-brain/runtime/assurance/` depend on the Kernel and on no adapter.
- The host-neutral adapter core at `plugins/immune-brain/runtime/host-core/` holds the adapter machinery both Hosts need, recorded by ADR 0038 (`docs/adr/0038-host-neutral-adapter-core.md` in the source repository). It depends on the Kernel, the Port and the coordinator, and on no adapter.
- Adapters (`plugins/immune-brain/runtime/claude/`, `plugins/immune-brain/runtime/antigravity/`, `.pi-extension/`) depend on the Port, the coordinator and the host-neutral core, never on each other. An adapter neither imports nor extends another adapter's machinery.
- The CLI and host entry points call adapters; nothing below them imports a host entry point.

A slice that adds or moves a dependency states its direction in its acceptance.

## Port Slicing

**Principle.** Slice work that touches a Port by Port method group, not by host, file, or layer. Each slice delivers one cohesive group of Port methods with a conformance test that every implementation of that group must pass.

**This repository.** New-host work is sliced by Port method group and sequenced seams first, state machines second, packaging last (see Execution Order). The per-host slice list and per-slice review stay with the issue that owns that host.

A conformance test for a method group runs against each adapter through the Port, so a second adapter is accepted by passing the same test rather than by a bespoke one.

## Mapping Convergence

**Principle.** A concept mapped to a host-specific form has one canonical form plus one projection per host. The projection is produced by subtracting from, or pointing at, the canonical form; it never re-describes it. Mapping the same concept to a host form in more than one place is a defect, because the copies drift.

**This repository.** The canonical instruction text lives in one source; each Host package carries a generated or mirrored projection guarded by `bun scripts/sync-dist-docs.ts --check` and `bun scripts/build-antigravity-plugin.ts --check`. A host that needs to differ declares the difference as a subtraction or a pointer in one place, not a forked copy.

A new layer, shared location, or cross-layer dependency needs an ADR before code, so the canonical form and its owner are recorded first.

## Module Documentation

When a module gains its own documentation, structure it as Interface / Invariants / Side Effects / Verification.

- **Interface** names what the module exposes.
- **Invariants** state what always holds.
- **Side Effects** name what the module changes outside itself.
- **Verification** names the test command that proves the module.

A module document without a Verification command is incomplete.

## Execution Order

Implement in this order and stop at the first failing step:

1. **Seam first.** Establish the Port or interface boundary and its conformance test.
2. **State machine second.** Implement behavior behind that seam.
3. **Packaging last.** Mirror, generate, and publish only after the behavior passes.

Share code between adapters through composition and neutral modules, never inheritance. Adapters neither import nor extend each other.

## Enforcement

The Dependency Rule is enforced by `tests/runtime-layering-boundary.test.ts`. It refuses an inner-layer import of a host adapter, an adapter import of another adapter, and a `runtime/kernel/` or `runtime/assurance/` import of `runtime/host-core/`. The host-to-host imports that remain are an exact ratchet baseline owned by #414: a new import fails, and a baseline entry whose import is gone fails as stale.

The third rule is recorded by ADR 0038 (`docs/adr/0038-host-neutral-adapter-core.md` in the source repository).

The Planner and Executor rules in this reference are instruction text. They are checked by Review and by `tests/layering-rules-contract.test.ts`, which proves the contracts say the rule and that every packaged copy matches this file; they do not prove a model obeys it. No new enforcement tool is introduced.
