# Assurance Kernel P2C: Supported-Host Default Kernel Routing (Pi)

## 1. Context

> **Phase 2 supersession:** `docs/specs/foreground-interactive-workflow-roadmap.spec.md` supersedes only P2C's direct long-running command ownership. `/imm-canary-new` now sends a visible Parent request for one TUI-only foreground `imm_canary_enrollment` Tool call. The no-waiver default route, backend affinity, preparation, confirmation, revalidation, rehearsal, and atomic enrollment contracts below remain unchanged.

P2B2 shipped and walked the first real canary (canary-001) end-to-end on the
Pi host: enroll -> evidence -> submit_review -> QA assurance -> complete ->
task tombstone, with workspace release back to v3 routing. The walkthrough
surfaced and fixed five production defects, all now covered by regression
tests (932 pass / 0 fail). The literal user then requested a short
validation window; the readiness qualifying window was shortened from 14 days
to 2 days (MIN_QUALIFYING_WINDOW_DAYS=2, at least one full UTC day span) and
the live repository is now `candidate` with zero gaps (window_days=3,
lifecycle_count=9, families execution/review/termination/activation covered).

P2C makes Kernel the default routing target for **newly created managed
tasks on the Pi host**. Existing v3 tasks keep backend affinity; v3 remains
fully functional until the separate P3 retirement decision. This follows the
parent cutover contract (docs/specs/assurance-kernel-v4-p2-managed-cutover.spec.md
§298: "P2C changes only the default for newly created managed tasks on
qualified hosts. Already-created tasks retain backend affinity.").

## 2. Goals

- Declare the short canary observation window and prove its zero-incident
  condition from durable evidence.
- Execute the missing drain drill (real Pi TUI `begin_drain` on a live
  canary) so the restart/rollback-drill promotion precondition is met.
- Add the default new-task creation route on Pi: creating a new managed task
  goes through the Kernel lifecycle by default, reusing every P2B1
  enrollment gate (prepare -> eligibility -> confirm -> revalidation ->
  rehearsal -> atomic enroll) with no waiver needed once readiness is
  `candidate`.
- Keep v3 Plan/Step creation available but non-default; never synthesize v3
  state from a Kernel task; never dual-write.

## 3. Out of Scope

- v3 retirement / stopping v3 new-task creation (P3, after P2C).
- OpenCode/RPC/JSON/print/CLI privileged authority; Pi TUI stays the only
  privileged host.
- Migration, import, or terminal TaskRecord reconstruction.
- Changing backend affinity of already-created tasks.
- Additional canary cohorts beyond the drill canary and ordinary new tasks.

## 4. Observation Window Declaration

The P2C observation window is declared as the span from canary-001
enrollment (2026-08-13T01:40:07Z) through completion of the P2C drain drill
and the literal user's promotion approval. Zero-incident condition, verified
from durable evidence only:

1. canary-001 completed its full lifecycle with no authority bypass, dual
   write, manual TaskRecord repair, restart, rollback, or terminalization
   incident (evidence: TaskRecord history, automatic observations v2,
   authority commit receipts v2, task tombstone, workspace release).
2. Readiness is `candidate` with zero gaps for the exact observer version
   (evidence: `imm-kernel readiness --json`).
3. The drain drill (Section 5) completes with a real Pi TUI confirmation and
   leaves the claim `draining` then terminal, with the workspace released.
4. No manual repair of `.imm/tasks/*`, workspace, claim, or tombstone files
   during the window (verified via git history — these paths are untracked
   worktree-local state, so their absence of commits is itself the record).

## 5. Drain Drill (executed as canary-004; canary-002/003 were stop-only attempts)

A real canary task exercises the drain path that canary-001 did not. As
recorded in `docs/evidence/assurance-kernel/p2c-drain-drill.md`, the first
two drill attempts (canary-002, canary-003) executed `enroll -> stop`
directly without the drain step and are documented as stop-only
walkthroughs; the complete drain drill was executed by canary-004:

- Intent: a minimal real task with one acceptance item verified by an
  existing test command (verification_descriptor/v1).
- `/imm-canary-enroll canary-004` (readiness is candidate; no waiver).
- `/imm-canary-authorize canary-004 begin-drain` (fresh TUI confirm).
  Verify: claim becomes `draining`, enrollment for the same task is
  rejected, v3 mutations remain blocked for the task, the workspace stays
  owned, TaskRecord phase unchanged.
- `/imm-canary-authorize canary-004 stop` (fresh TUI confirm). Verify:
  terminal tombstone, workspace released, v3 routing restored.
- Record the drill outcome in a committed evidence note
  (`docs/evidence/assurance-kernel/p2c-drain-drill.md`).

Drill failure closes the window and halts P2C promotion; the drill may be
re-run after root cause remediation.

## 6. Default New-Task Route (Pi)

### 6.1 Entry point

`/imm-canary-new <task-id>` is a TUI-only visible launcher and remains the default way to start a new managed task on Pi. It sends a Parent request for one foreground `imm_canary_enrollment` Tool invocation. The Tool reuses the P2B1 enrollment machinery verbatim (preparePiCanary -> evaluateCanaryEligibility -> ctx.ui.confirm -> revalidatePiCanary -> runEnrollmentRehearsal -> enrollCanaryTask) with one difference: eligibility must pass without a waiver (readiness `candidate`), so a non-candidate readiness rejects before confirmation. Its direct terminal result routes the session to `imm-canary-work`; no background notification or result recovery path exists.

`/imm-canary-enroll` remains the visible launcher for explicit re-enrollment semantics; both launchers share the same foreground Tool owner.

### 6.2 Routing gate

`imm-canary-work` activation gate update: with no active claim, the
projection now reports "Kernel is the default route for new tasks on this
host" and directs new-task creation to `/imm-canary-new`; the v3 route stays
available and unchanged for existing Plans. The gate remains read-only and
re-evaluated per continuation; it never auto-creates a task.

### 6.3 Failure modes

- Non-candidate readiness: reject before confirmation (no waiver).
- Drift after confirmation: abort (existing revalidation).
- Rehearsal failure or enrollment error: zero writes (existing semantics).
- Canary rollback (user-directed): disable new Kernel enrollment, leave v3
  tasks unchanged, let active Kernel tasks drain or stop (existing P2B2
  machinery); never synthesize v3 state.

## 7. Verification Contract

- Full suite stays green (932+ tests, 0 fail).
- New focused tests: `imm-canary-new` command surface (TUI-only gate,
  candidate-required eligibility, no-waiver path, zero-write failure modes),
  routing gate projection text, drain drill evidence note exists and
  matches the recorded claim/tombstone lifecycle.
- `imm-kernel readiness --json` shows `candidate` with zero gaps on the live
  repository after the drill.
- Real TUI drill evidence (confirm refs, claim transitions) recorded in the
  committed drill note.

### 7.1 Readiness bundle maintenance protocol

The migration dry-run digest pinned in `docs/evidence/assurance-kernel/readiness.json`
derives from the State Ledger, so **any Ledger write** (plan activation,
`record-execution`, review recording, `imm-finish`) changes the digest and
makes the committed bundle stale: readiness correctly fails closed
(`evidence_bundle_invalid`) until the bundle is refreshed. Operating
protocol: before any enrollment or promotion check that requires a
`candidate` epoch, refresh the bundle (recompute the current canonical
migration digest, collect the current observation receipt ids, update
`generated_at`, commit) and re-verify `imm-kernel readiness --json` shows
`candidate` with zero gaps. Do not run ledger-writing commands between the
refresh and the enrollment/promotion verification.

## 8. Successor Boundary

P3 (v3 retirement) starts only after P2C promotion, as a separate value
decision: stop new v3 task creation, retain read-only v3 projection, decide
terminal import explicitly. P2C itself makes no v3 changes.
