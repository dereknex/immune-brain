---
title: "Assurance Workflow Hardening"
type: improvement
status: pending
date: 2026-08-16
---

# Plan: Assurance Workflow Hardening

Remove the structural friction that made one feature (phase-aware Assurance
deadlines) consume eight hours, five sequential canary tasks, eleven manual
TUI round trips, and roughly fifty defensive status polls.

- Summary: Harden the Assurance workflow end to end — upfront settlement
  design, trustworthy notifications, durable cancel semantics, one-command
  succession, dispatch resilience, neighborhood-aware review, and
  enrollment-time descriptor rehearsal.

## Origin

- **Source**: Retrospective of Pi session `01a0088c-a224-7358-986f-d811e1bfe00c`
  (2026-08-16, tasks `2026-08-16-001` through `-005`).
- **Evidence**: five repair successors for one feature; every Review finding
  was the same semantic class (paths still trusting local handle state instead
  of host receipts) discovered serially; >=5 late notifications without
  `operation_id` drove defensive polling and one user-visible "missing
  confirmation" confusion; two cancelled TUI confirmations stalled the
  pipeline for two hours; provider 429s and a garbage-collected `evidence.json`
  forced three Review re-dispatches; flaky default test timeouts and fixture
  timer leaks consumed QA rounds.

## Decisions

- All intents are authored **upfront as one program** and enrolled
  strictly sequentially — no serial discovery, no fragmenting one semantic
  change across tasks. The program grew from seven to nine intents when
  006's Review surfaced an out-of-scope root cause that required a dedicated
  successor (013) before the remaining review-touching steps run.
- Every settlement-adjacent intent embeds its own trigger-by-state-by-owner
  enumeration directly in its acceptance assertions (dogfooding item 006
  before it lands).
- User interactions are batched: each critical task needs exactly one
  enrollment confirmation plus one completion approval; the successor command
  (009) collapses the former stop-then-enroll pair into one confirmation.
- Per-descriptor evidence rebinding (retro item P2-8) is **deferred**: it
  conflicts with the scope-isolated digest binding in project memory #1520 and
  requires an ADR before any code. Not part of this program's intents.

## Steps

### Step 1 — `2026-08-16-006-settlement-design-contract` (risk: material)

- Result: Packaged planner contract requires every settlement-class TaskIntent
  to embed a trigger x state x terminal-owner enumeration and to list every
  same-state-machine path in scope_hint; the pattern is recorded in
  `docs/solutions/contracts.md` with its retro evidence.
- Verification: `tests/planner-settlement-contract.test.ts` (new) plus both
  skill-registry consistency suites; full regression.

### Step 2 — `2026-08-16-014-review-budget-scaling` (risk: material)

Added after 013 stopped: its heavy review (570KB, 11 files, 6 acceptances) could
not complete within the fixed 12-turn budget — three dispatch attempts aborted
or truncated with no verdict, leaving the task parked in `review` with stale
evidence and no in-task recovery. 014 carries 013's full contract plus
`acc-review-turn-budget`: reserved Review turn budget scales by workload
(quick 12 / standard 16 / heavy 24) at every dispatch site, documented in the
protocol contract.

- Result: `reviewTurnBudget` mapping wired into both dispatch paths; heavy
  bundles never dispatch with the quick budget; protocol docs state scaled
  budgets in source and packaged copies.
- Verification: `tests/pi-canary-review-outcome-evidence.test.ts`,
  `tests/pi-canary-work-extension.test.ts`,
  `tests/pi-subagent-dispatch-observability-contract.test.ts`; full regression.

### Step 3 — `2026-08-16-013-review-contract-outcome-evidence` (risk: material)

Added after 006 stopped on a Review finding whose root cause (no outcome
evidence in the immutable bundle) lies outside 006's scope. Runs before all
remaining review-touching steps because every later task's Review rounds
depend on the fixed contract.

- Result: The host-captured review bundle embeds per-acceptance verification
  outcomes from the TaskRecord, frozen at capture under the reservation lock;
  the reserved Review prompt states the QA/Review division of labor so
  isolated reviewers verify provenance and code rather than re-executing
  descriptors; the outcome-embedding path carries its trigger x state x
  owner enumeration per the settlement-design contract.
- Verification: `tests/pi-canary-review-outcome-evidence.test.ts` (new);
  dispatch observability contract; planner-settlement contract suites;
  full regression.

### Step 4 — `2026-08-16-015-confirm-cancel-decision-trail` (risk: material)

Added after 008 stopped a second time: its rework Review could not be recorded
because the fixing edits changed the snapshot diff, making the pending rework
verdict unappliable and parking the task in `review` with stale evidence —
the same no-verdict deadlock as 013. 015 carries 008's completed wiring (cancel
paths record exactly one durable `unresolved_user_decision`; verdict cancels
discard the pending verdict; kernel accepts canonical `user-decision-` finding
ids; resolve-user-decision closes the trail) and records all evidence fresh in
working phase.

- Result: The decision-trail wiring lands with a clean baseline diff.
- Verification: `tests/pi-canary-confirm-cancel-decision.test.ts`,
  `tests/pi-canary-work-extension.test.ts`, `tests/pi-canary-user-authority.test.ts`
  plus the single-terminal and kernel suites; full regression.

### Step 5 — `2026-08-16-007-notification-correlation` (risk: material)

- Result: Every user-visible Assurance notification carries task_id and
  operation_id; delivery for settled or terminal operations is suppressed or
  explicitly annotated `superseded`; stale notifications never prompt action.
- Verification: `tests/pi-canary-notification-correlation.test.ts` (new) with
  injected out-of-order events; observability contract suites; full regression.

### Step 6 — `2026-08-16-008-confirm-cancel-decision-trail` (risk: critical, superseded by 015)

- Result: Cancelling any Assurance literal-user confirmation records exactly
  one durable `unresolved_user_decision` bound to the blocked operation and
  snapshot; the pending payload survives session restart; resume goes through
  the existing `resolve-user-decision` authority path with the identical
  operation; repeated cancels deduplicate; invocation tokens always release.
- Verification: `tests/pi-canary-confirm-cancel-decision.test.ts` (new);
  single-terminal and continuation invariants; full regression.

### Step 7 — `2026-08-16-009-successor-one-command` (risk: critical)

- Result: A single TUI command valid only under `replan_required` performs
  stop, claim release, same-scope successor intent derivation, validation, and
  atomic enrollment as one linearized operation behind exactly one
  literal-user confirmation; cancel before commit writes nothing; crash
  recovery accepts only all-before or all-after.
- Verification: `tests/pi-canary-succeed-command.test.ts` (new); enrollment
  authority contract suites; full regression.

### Step 8 — `2026-08-16-010-review-dispatch-resilience` (risk: material)

- Result: Review bundle artifacts outlive unsettled reservations; missing
  artifacts fail closed with an explicit re-reserve path; provider
  quota/transport failures are classified as no-verdict dispatch failures that
  write zero authority and never consume a review follow-up round.
- Verification: `tests/pi-canary-review-dispatch-resilience.test.ts` (new);
  native-review and progression suites; full regression.

### Step 9 — `2026-08-16-011-review-semantic-neighborhood` (risk: material)

- Result: Settlement-class review bundles include same-state-machine sibling
  files drawn exclusively from scope_hint under existing size limits, with
  provenance distinguishing diff payloads from neighborhood context; the
  reserved Review prompt requires enumerating every terminal, cancellation,
  and race path present in the bundle.
- Verification: `tests/pi-canary-review-neighborhood.test.ts` (new);
  dispatch observability contract; full regression.

### Step 10 — `2026-08-16-017-descriptor-rehearsal-integrity-settlement` (risk: material)

- Supersedes: `2026-08-16-012-descriptor-rehearsal-preflight` and
  `2026-08-16-016-descriptor-rehearsal-preflight`, which reached their
  two-round Review follow-up limits while exposing frozen-index, process
  settlement, and live-integrity gaps.
- Result: Enrollment readiness runs a bounded, read-only concurrency rehearsal
  from one frozen Git index snapshot. A live monitor aborts all descriptors on
  index/scope drift and binds tracked dirty plus untracked content bytes into
  the parent mutation fingerprint. Setup timeout, cancellation, output limit, setup
  failure, and integrity drift are non-waivable; only descriptor validation,
  nonzero exit, and descriptor execution timeout can reach the explicit
  literal-user waiver route. Every started process tree settles through close
  before isolated-copy cleanup.
- Verification: `tests/kernel-descriptor-rehearsal.test.ts` (new); enrollment
  contract suites; full regression.

## Devil's Advocate Audit

- **"Notifications might hide real events" (007)**: settled-operation
  notifications are annotated `superseded`, never silently dropped; the
  authoritative TaskRecord remains the source of truth and the audit trail is
  unchanged.
- **"One-command succession weakens the two-route enrollment boundary"
  (009)**: the literal-user confirmation is preserved and displays the full
  stop + release + derive + enroll payload; the Git-tracked TaskIntent
  requirement, revalidation, and waiver route semantics are untouched; the
  command is valid only under `replan_required`.
- **"Cancel-recorded findings could spam on accidental cancels" (008)**:
  exactly one open `unresolved_user_decision` per operation; repeated cancels
  deduplicate onto it.
- **"Neighborhood bundles could leak out-of-scope content into review"
  (011)**: sibling selection is restricted to files already inside the task
  scope_hint, under the unchanged 2 MiB total / 256 KiB per-file limits;
  isolation still reads only bundle bytes.
- **"Rehearsal slows enrollment" (017, superseding 012 and 016)**: rehearsal is parallel,
  bounded by descriptor timeouts, read-only, and runs once per enrollment; the
  waiver route preserves an escape hatch with explicit confirmation only for
  descriptor validation, nonzero exit, and descriptor execution timeout.
  Setup timeout, cancellation, output limit, setup failure, and snapshot
  integrity failures remain non-waivable.
- **"Seven intents is fragmentation"**: each item is an independent semantic
  change in a distinct subsystem (contracts, notifications, cancel lifecycle,
  succession, dispatch, bundle capture, enrollment preflight). The retro
  failure mode was splitting *one* semantic change across five tasks; this
  program designs all seven upfront and enrolls them sequentially, which is
  the opposite failure-avoidance. The eighth and ninth intents (013/014) were added when
  006's Review finding proved the bundle lacked outcome evidence — a real
  contract gap that must land before any later task's Review rounds.

## Next Action

Enroll `2026-08-16-014-review-budget-scaling` via Pi TUI
`/imm-canary-new 2026-08-16-013-review-contract-outcome-evidence`, then proceed in
step order. Each intent file is Git-tracked under `docs/plans/` and validated
by `imm-kernel intent validate`.
