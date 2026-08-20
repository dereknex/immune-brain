# Plan: Assurance Kernel P2C Pi Default Kernel Routing

**plan_format**: v2
**Plan ID**: 2026-08-13-014
**Type**: feat
**Workflow profile**: strict
**Compounder**: required
**Created**: 2026-08-13
**Status**: pending
**Priority**: P1
**Spec**: docs/specs/archive/assurance-kernel-v4-p2c-pi-default-routing.spec.md
**Predecessor**: docs/plans/2026-08-12-013-feat-assurance-kernel-p2b2-pi-canary-lifecycle-plan.md (closed and finished)

## Goal

Make Kernel the default routing target for newly created managed tasks on the Pi host, after a declared short observation window and a real drain drill prove the canary route incident-free, without changing v3 affinity or synthesizing v3 state.

## Task

Implement the P2C executable slice: (1) declare and evidence the short observation window including the missing drain drill on a second real canary, and (2) add the default new-task creation route `/imm-canary-new` that reuses the P2B1 enrollment gate with a no-waiver candidate requirement, plus the routing-gate projection update. v3 Plan/Step creation remains available and unchanged.

## Output Language

Spec and Plan prose use English. Schema fields, CLI commands, file paths, JSON keys, enum values, Step IDs, and contract identifiers remain literal.

## Origin

P2B2 shipped and walked canary-001 end-to-end (enroll -> evidence -> submit_review -> QA -> complete -> tombstone) with zero incidents, fixing five production defects now covered by regression tests (932 pass). The literal user requested a short validation window; the readiness qualifying window was shortened to 2 days and the live repository is `candidate` with zero gaps (window_days=3, lifecycle_count=9). The parent cutover spec (§P2C) requires for promotion: a separately declared canary window, zero authority bypass/dual-write incidents, no manual TaskRecord repair, successful restart/rollback drills, and literal user approval. canary-001 never exercised the drain path, so the drain drill is the only unmet promotion precondition.

## Research

- `/imm-canary-enroll` (imm-canary-enroll.ts) already implements the full enrollment gate: TUI-only, preparePiCanary, evaluateCanaryEligibility with waiver, exact-task confirm, revalidatePiCanary, runEnrollmentRehearsal, atomic enrollCanaryTask. With readiness `candidate` and zero gaps, `evaluateCanaryEligibility` now returns `eligible` without any waiver (candidate epoch path), so `/imm-canary-new` can require the no-waiver path and reject non-candidate readiness before confirmation.
- `/imm-canary-authorize <task-id> begin-drain` and `stop` are implemented and tested (pi-canary-user-authority.test.ts): fresh TUI confirm, linear invocation registry, capability-bound beginDrain/stop through the paired application. The drill needs no code changes.
- The `.pi-extension/package.json` entry manifest lists factory files explicitly; adding a third factory (`imm-canary-new.ts`) requires updating the manifest and the discovery regression test (tests/pi-canary-discovery-regression.test.ts asserts exactly two factories).
- `imm-canary-work` SKILL.md activation gate is read-only and re-evaluated per continuation; the P2C gate update only adds projection text about the default new-task route and never auto-creates a task. Skill registry metadata is unaffected because the frontmatter (name/description) is unchanged.
- TaskRecord/tombstone/workspace paths are worktree-local (`.gitignore` covers `.imm/tasks/`), so window-incident verification relies on the durable receipt/observation journals plus the committed drill note rather than git history of state files.

## Decisions

1. Declare the P2C observation window as canary-001 enrollment (2026-08-13T01:40:07Z) through drill completion plus literal-user promotion approval; zero-incident condition is verified from automatic observations v2, authority commit receipts v2, readiness `candidate` with zero gaps, and the committed drill note. The window is deliberately short per the user's request; the readiness gate (2 days) and the window are separate mechanisms.
2. Execute the drain drill on a second real canary (canary-002) with a minimal real intent: enroll -> record one evidence item -> `/imm-canary-authorize begin-drain` (fresh confirm) -> verify `draining` claim, enrollment rejection, v3 guard, workspace ownership -> `/imm-canary-authorize stop` (fresh confirm) -> verify terminal tombstone and workspace release. Record the outcome in a committed note `docs/evidence/assurance-kernel/p2c-drain-drill.md`. Drill failure closes the window and halts promotion.
3. Add `/imm-canary-new <task-id>` as the default new-task entry: TUI-only, reuses the P2B1 enrollment machinery verbatim, requires `evaluateCanaryEligibility` to pass without a waiver (readiness must be `candidate`), rejects non-candidate readiness before any confirmation, and reports the read-only projection plus `imm-canary-work` routing after enrollment. `/imm-canary-enroll` stays unchanged for explicit waiver-capable enrollment.
4. Update the `imm-canary-work` activation-gate projection: with no active claim, report "Kernel is the default route for new tasks on this host" and direct new-task creation to `/imm-canary-new`; the v3 route remains available and unchanged for existing Plans. The gate never auto-creates a task and stays read-only.
5. Keep v3 fully intact: no v3 Plan/Step creation change, no dual write, no synthesized v3 state from Kernel tasks, no affinity change for existing tasks. Rollback of the default route = disable new Kernel enrollment and leave v3 untouched (existing P2B2 drain/stop machinery).
6. P3 (v3 retirement) is not executable here: this Plan records the P3 decision point (stop v3 new-task creation, retain read-only v3 projection, explicit terminal-import decision) in the Spec, to be planned separately after P2C promotion.

## Assumptions

- canary-002's intent is a minimal real task whose acceptance verification is an existing test command (verification_descriptor/v1), so the drill has no bespoke code.
- The user performs the two TUI confirms (`begin-drain`, `stop`) during the drill; the Step executor records the evidence note and verifies the persisted state transitions after each user step.
- Readiness remains `candidate` with zero gaps throughout the window; a regression to `blocked`/`collecting` closes the window and halts promotion until remediated.
- No other Kernel task is enrolled during the window except canary-002 (and ordinary new tasks created through `/imm-canary-new` once U2 ships, which are themselves window evidence).

## Roadmap Source

`docs/specs/archive/assurance-kernel-v4-p2-managed-cutover.spec.md`

## Execution Scope

P2C only: observation-window declaration and drain drill evidence, default new-task route on Pi, routing-gate projection text, focused tests, P3 decision-point documentation.

## Deferred Phases

P3 v3 retirement (stop new v3 task creation, read-only v3 projection, terminal-import decision) is a separate Plan after P2C promotion. OpenCode/RPC privileged hosts remain excluded. Additional canary cohorts beyond the drill canary are not required.

## Current-Slice Warning

This is not the full P2 Roadmap implementation Plan. It does not retire v3, change existing-task affinity, add a second privileged host, auto-select canaries, or migrate/import terminal state.

## Plan Boundary

One coherent P2C slice covers the promotion evidence (short window + drain drill) and the default new-task route with its routing-gate projection, because promotion without a default route has no operational meaning and a default route without promotion evidence would bypass the declared observation gate. v3 retirement remains a separate P3 boundary.

## Boundary Rationale

Shipping the drill without the route would leave P2C at "evidence only" with no behavioral change; shipping the route without the drill would violate the promotion precondition the user asked to compress. Both belong to the same promotion decision. P3 is separated because it changes v3's lifecycle (stopping creation) rather than the default for new tasks.

## Steps

### Step 1

- Result: The declared short observation window closes with a completed real drain drill.
- Scope: `docs/specs/archive/assurance-kernel-v4-p2c-pi-default-routing.spec.md`; `docs/evidence/assurance-kernel/p2c-drain-drill.md`; `plugins/immune-brain/runtime/kernel/readiness.ts`; `tests/kernel-readiness.test.ts`; `tests/kernel-pi-canary-live-boundary.test.ts`
- Verification: `test -f docs/specs/archive/assurance-kernel-v4-p2c-pi-default-routing.spec.md && test -f docs/evidence/assurance-kernel/p2c-drain-drill.md && bun test tests/kernel-readiness.test.ts tests/kernel-pi-canary-live-boundary.test.ts tests/kernel-readiness-evidence.test.ts tests/kernel-canary-eligibility.test.ts && plugins/immune-brain/bin/imm-kernel readiness --json | grep -q '"status": "candidate"' && grep -q 'canary-002' docs/evidence/assurance-kernel/p2c-drain-drill.md && grep -q 'draining' docs/evidence/assurance-kernel/p2c-drain-drill.md && grep -q 'terminal' docs/evidence/assurance-kernel/p2c-drain-drill.md && git diff --check`
- Verification type: automated

### Step 2

- Result: The Pi host creates new managed tasks through a Kernel default route with a no-waiver candidate gate.
- Scope: `plugins/immune-brain/.pi-extension/imm-canary-new.ts`; `plugins/immune-brain/.pi-extension/package.json`; `plugins/immune-brain/skills/imm-canary-work/SKILL.md`; `plugins/immune-brain/dist/imm-canary-work.md`; `tests/pi-canary-new-extension.test.ts`; `tests/pi-canary-discovery-regression.test.ts`
- Verification: `test -f plugins/immune-brain/.pi-extension/imm-canary-new.ts && test -f tests/pi-canary-new-extension.test.ts && bun test tests/pi-canary-new-extension.test.ts tests/pi-canary-discovery-regression.test.ts tests/pi-canary-enroll-extension.test.ts tests/pi-canary-package-boundary.test.ts tests/pi-canary-work-extension.test.ts tests/plugin-package-runtime.test.ts tests/dist-docs-sync-contract.test.ts && bun x tsc --noEmit -p plugins/immune-brain/.pi-extension/tsconfig.json && bun scripts/sync-dist-docs.ts --check && bun test && plugins/immune-brain/bin/imm-plan docs/plans/2026-08-13-014-feat-assurance-kernel-p2c-pi-default-routing-plan.md --json && git diff --check`
- Verification type: automated
