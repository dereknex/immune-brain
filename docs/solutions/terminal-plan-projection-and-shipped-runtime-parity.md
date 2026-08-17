---
reusability: medium
key_files:
  - docs/specs/2026-07-28-roadmap-plan-boundary-successor.spec.md
  - docs/plans/2026-07-29-002-feat-roadmap-plan-boundary-successor-phase4-plan.md
  - plugins/immune-brain/runtime/immune_brain_runtime.ts
  - tests/roadmap-plan-terminal-runtime.test.ts
  - tests/roadmap-plan-e2e.test.ts
  - tests/roadmap-plan-host-acceptance.test.ts
next_reuse_scenarios:
  - A file-backed workflow needs a terminal local checkpoint after explicit closure without claiming global project completion.
  - A successor lifecycle must be proven across fresh CLI processes, copied package artifacts, and multiple host adapters.
  - Read-only status or autowork projections need byte-stable behavior and must not create approval-like authority.
  - A shipped wrapper or adapter must prove it preserves shared runtime semantics without falling back to the source checkout.
---

# Pattern: Terminal Plan Projection and Shipped Runtime Parity

## Reusable premise

When a contracted Plan is terminal (`Successor candidate: none`), represent completion as a derived local checkpoint after the existing closure order has settled: every Step and required review gate is closed, the explicit Compounder handoff has occurred, and `imm-finish` has committed the reset. The read path should expose `terminal_plan_complete` with no next skill, authority, required input, or allowed action. It should expose the same opaque Ledger revision as status, state the exact local next action, and avoid claiming global Roadmap completion.

Treat this projection as a transport contract, not a new persisted state. Fresh processes, plugin-local wrappers, copied package artifacts, and structured Host adapters must all derive the same authority semantics from the same Plan and Ledger bytes. Validation-only paths stay read-only; the direct revision-bound CLI remains the only successor approval route.

## Evidence

- Spec section 5.7.1 defines the terminal projection fields, pre-finish Compounder ordering, local-only meaning, legacy compatibility, and no-write requirement: `docs/specs/2026-07-28-roadmap-plan-boundary-successor.spec.md`.
- P4 U1 implements and tests the derived checkpoint and priority ordering in `plugins/immune-brain/runtime/immune_brain_runtime.ts` and `tests/roadmap-plan-terminal-runtime.test.ts`; the U1 suite passed 23 tests with 0 failures.
- P4 U2 exercises validation-only reads, revision-bound approval, one archive/transition append, successor-only pending Steps, terminal lifecycle, stale/duplicate/replaced/active/replanning failures, and a supported fresh-process competing writer. The exact suite passed 117 tests with 0 failures and 961 assertions.
- P4 U3 copies the plugin outside the checkout, invokes the copied wrappers against a separate target root and temporary HOME, checks Host manifests and OpenCode argv boundaries, and verifies terminal behavior without mutating the source Ledger. The exact suite passed 44 tests with 0 failures and 276 assertions; version validation, dist-doc sync, plugin checks, and diff checks also passed.
- Independent `imm-qa` passed U1, U2, and U3. The exact-signature `imm-code-review` gate passed for the complete P4 U1-U3 changed-file surface with no findings.

## Boundaries

- `terminal_plan_complete` is local Plan truth, not proof of Roadmap membership, phase order, global completion, or successful vendor UI loading.
- `awaiting_user_successor_decision` remains the non-terminal post-finish boundary; terminal Plans do not emit it.
- Active, QA, review, follow-up, rework, and replan checkpoints retain priority over terminal or successor messaging.
- A copied package must resolve its own runtime and wrappers against its target root. A source-checkout fallback is not acceptable package evidence.
- OpenCode and other structured adapters may validate or report checkpoints, but must not transport `--approve-successor`, predecessor identity, or Ledger revision approval options.
- Legacy Plans and ordinary schema-v2 same-Plan lifecycle behavior remain compatible; P4 does not add historical adoption, a schema-v4 migration, a queue, a scheduler, or Roadmap topology parsing.

## Debate & Evidence Critique

- **Falsifiability:** The pattern is false if a future runtime needs persisted terminal state, global Roadmap topology proof, or a successor queue to make the local checkpoint truthful. Those requirements would be a new authority boundary and must return to Planner rather than being smuggled into this projection.
- **Evidence trail audit:** The claim is supported by the P4 spec, the exact U1/U2/U3 automated suites, fresh wrapper execution, isolated package checks, independent QA, and the exact-signature code review. It does not prove live vendor loading, arbitrary package managers, or all possible Host implementations.
- **Architecture entropy resistance:** This is a standalone solution because it joins runtime checkpoint semantics with package/Host transport parity, while the existing successor-authority learning covers approval ownership and transition grammar. No new runtime subsystem or Architecture Map entry is justified.

## Reuse tags

`reusability: medium`

**Next reuse scenarios:** Reuse this pattern when a workflow has a terminal local slice, read-only status projections, explicit approval boundaries, or multiple shipped transports. Do not reuse it as a license to infer global project completion or to add automatic successor activation.
