---
status: accepted
---

# Host capability contract and tri-host composition

**Status update:** This ADR records Slice S1 of
`docs/specs/tri-host-capability-alignment.spec.md` (BR-REQ-1, BR-DEC-1, BR-DEC-4;
D1, D2, D12) and amends [ADR 0038](0038-host-neutral-adapter-core.md). It builds
on [ADR 0004](0004-dual-host-assurance-adapters.md) and
[ADR 0035](0035-layering-doctrine.md).

Accepted by the repository owner for Issue #481.

## Context

The repository supports three Host adapters: Claude Code (`runtime/claude/`),
Antigravity (`runtime/antigravity/`), and Pi (`.pi-extension/`). Over time, each
adapter accumulated uneven capability evidence and forked implementations for
authority-correlation storage, verifier observation, runtime composition, run
continuation, and Review CLI isolation.

Earlier architectural analyses also conflated current, planned, and stale facts.
To maintain verifiable boundaries across all three Hosts, the project requires:
1. One canonical, machine-checked capability contract defining host support and
   evidence levels across nine defined ports P1–P9.
2. A strict boundary ensuring capability declarations remain documentation and
   conformance inputs, not an autonomous dispatcher or dynamic registry.
3. Convergence of all three Hosts as sibling adapters over `host-core`, retiring
   the historical note in ADR 0038 that kept Pi outside `host-core`.

## Decision

1. **Capability declaration, not dispatch (D1).** `host-core/capability.ts`
   defines the nine port IDs P1–P9 and four evidence levels:
   - `certified`: Verified with real host end-to-end evidence.
   - `conformance-only`: Verified against local conformance test suites.
   - `guard-only`: Protected by defensive runtime checks with residual risks disclosed.
   - `unsupported`: Unsupported by the host, with reason documented.

   The port meanings are:
   - P1: call correlation/phase admission
   - P2: native confirmation
   - P3: verifier observation
   - P4: run continuation
   - P5: Review/Verify CLI isolation
   - P6: Lane Executor spawn
   - P7: private cache storage
   - P8: active-task/model-entry Host integration
   - P9: background wake

   Each adapter exports exactly one declaration at its composition root:
   - Claude Code: `plugins/immune-brain/runtime/claude/capability.ts`
   - Antigravity: `plugins/immune-brain/runtime/antigravity/capability.ts`
   - Pi: `plugins/immune-brain/.pi-extension/pi-capability.ts`

2. **No dynamic registry or autonomous dispatcher (D2).** ADR 0004 remains
   authoritative. Capability declarations are documentation and conformance
   inputs only. Production control flow never selects a Host or resolves tool
   dispatch through capability declarations. Existing profile wiring and
   explicit configuration remain the sole adapter selection mechanisms.

3. **Tri-host adapter architecture (D12).** ADR 0038 is amended: the dependency
   direction is `kernel ← assurance ← host-core ← adapters (claude, antigravity, pi)`.
   The Pi adapter may import `host-core`. Adapters remain siblings and never
   import or inherit each other.

4. **Maintainer matrix generation.** `scripts/render-host-capability.ts` explicitly
   imports the three composition-root declarations and renders the reference
   table in [docs/reference/host-capability.md](../reference/host-capability.md).
   Conformance tests reject unknown ports, missing/duplicate cells, unsupported
   levels, and drifted tables.

## Consequences

- Maintainers have a machine-checked, single-page matrix of capability evidence
  and limitations for all three Hosts at `docs/reference/host-capability.md`.
- No dynamic registry, reflection, or autonomous host-dispatch code exists.
- Slices S2–S8 update individual adapter declarations as concrete evidence and
  alignment land, regenerating the same canonical table.
