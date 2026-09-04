# Spec: Task Rail Progress Depth And Read-Only Task Overview Overlay

**Task ID**: `2026-09-04-001-task-rail-progress-depth-and-overview`
**Owner**: user
**Status**: Proposed
**Design risk**: Medium

This change deepens the existing Task Rail for the active Managed task and adds
one on-demand read-only task overview overlay. It changes no Kernel authority,
TaskRecord, claim, attestation, or settlement semantics. Every displayed fact
comes from already-read projections or existing foreground progress payloads.

**Diagram decision**: not_required
**Diagram reason**: The change extends one existing presentation module with two
additional pure renderers fed by existing data sources. It introduces no new
participants, no new state machine, and no cross-process interaction beyond the
documented Overlay pattern already used by authorization dialogs; prose in
Technical Design is sufficient.

**Brainstorm manifest**:

- BR-REQ-1: Task Rail acceptance checklist + QA progress + Assurance phase
  indication for the active task.
- BR-REQ-2: `/imm-tasks` on-demand read-only overlay listing active and
  not-enrolled tasks.
- BR-DEC-1: Data source is read-only projection only; no second state source.
- BR-DEC-2: Overview is an on-demand overlay, not a persistent widget.
- BR-DEC-3: Settled history is excluded from the overlay (CLI remains the
  history surface).
- BR-OUT-1: UI is strictly read-only; no task selection or operation trigger.
- BR-OUT-2: No GitHub Initiative synchronization view.
- BR-OUT-3: Footer stays empty.
- BR-DEFER-1: Persistent overview count row on the Rail (deferred; revisit
  after the overlay lands).

## Output Language

Spec and TaskIntent prose are English. Schema keys, CLI commands, file paths,
code identifiers, JSON keys, and canonical terms (`Task Rail`, `Assurance
Projection`, `TaskIntent`, `Acceptance Descriptor`, `Obligation`, `Spec`,
`Step`) remain literal.

## Problem

The Task Rail (`pi-canary-interaction.ts`) currently renders only three rows —
task identity, one normalized state, and `Result` / `Next`. During deterministic
QA the runtime already produces per-descriptor
`QaVerificationProgress` (index, total, acceptance_id, phase, elapsed), but
those facts collapse into one bounded text line; the acceptance checklist is
invisible until the terminal Final Card. Across tasks there is no TUI surface
at all: active-task state and not-enrolled `docs/plans/*.intent.json` drafts
can only be seen via CLI or filesystem inspection. The user cannot follow
overall progress or pending work at a glance.

## Result

1. The Task Rail for the active task renders, in addition to the existing
   rows: an Assurance phase indication derived from the existing normalized
   Rail state, and during foreground QA a bounded per-descriptor acceptance
   checklist (`✓`/`✗`/`running` + acceptance_id + elapsed) fed only from the
   existing `onProgress` / `ForegroundToolUpdate` payload. On terminal states
   the Rail keeps rendering the existing Final Card lines.
2. A new `/imm-tasks` host command opens one read-only overlay listing the
   current workspace's active Managed task (with its projected Obligation and
   Rail state) and every not-enrolled `docs/plans/*.intent.json` (shown as
   Planning), excluding settled history. Closing the overlay changes nothing.
3. No second workflow state source: every fact is read at open time or relayed
   from an existing foreground update payload.

## Research

- `pi-canary-interaction.ts` owns `TaskRailView`, `renderTaskRail`,
  `railState`, `presentTaskRail`, and the SelectList-overlay pattern
  (`requestAuthorityDialog`) already imported from `@earendil-works/pi-tui`
  (Container, DynamicBorder, Text, SelectList).
- `imm-canary-work.ts` refreshes the Rail via `refreshTaskRail` /
  `presentTaskRailResult`; QA progress flows through
  `progress("verifying", ..., { current, total, acceptance_id })` in
  `runtime/assurance/coordinator.ts` and `runDeterministicQa`'s `onProgress`.
- Active ownership: `readBackendClaim(root)` (workspace claim at most one
  active task); not-enrolled drafts: `docs/plans/*.intent.json` files that are
  not the enrolled sidecar; validation precedent:
  `parseTaskIntentV1` via `runtime-stub`.
- Test seams: `tests/pi-canary-work-extension.test.ts` (Rail lifecycle,
  renderResult contracts, forbidden-source scan) and
  `tests/kernel-intent-authoring.test.ts` (CLI authoring). Overlay prior art:
  `requestAuthorityDialog` uses `ctx.ui.custom` with
  `{ overlay: true, overlayOptions: ... }`.
- Superseded `footer-free-enrollment-progress.spec.md` retired the detached
  Enrollment coordinator and refresh timer; this Spec adds no timer, background
  refresh, or Footer content, consistent with that supersession.

## Decisions

- Checklist and phase rows render inside the existing Task Rail widget
  (bounded, pure functions of the latest view); no second widget key.
- The `/imm-tasks` overlay is a `pi.registerCommand` handler using the
  existing `ctx.ui.custom` overlay pattern with a read-only rendering; ESC
  closes it. It reads the backend claim, the Assurance projection, and the
  `docs/plans/` directory only when invoked.
- Draft-vs-enrolled classification: a `docs/plans/*.intent.json` path is
  "not-enrolled" when the active backend claim's task sidecar is not that path
  and no audit tombstone references that task id; simplest robust rule is:
  sidecar basename task id ≠ active claim task id (history excluded per
  BR-DEC-3 anyway).
- QA progress is rendered only while a foreground QA Tool update carries
  `{ current, total, acceptance_id }`; there is no stored checklist state.
  Re-render happens only at existing update boundaries (same constraint as the
  current Rail).

## Technical Design

### Affected components

- `pi-canary-interaction.ts`: extend `TaskRailView` with optional
  `phase?: string` and `acceptance_progress?: { current: number; total:
  number; acceptance_id: string; state: "running" | "passed" | "failed";
  elapsed_ms?: number }`; extend `renderTaskRail` with one optional phase row
  and one optional checklist row (only the latest descriptor plus a compact
  `n/total` counter, keeping the Rail ≤ 6 bounded rows).
- `imm-canary-work.ts`: relay the existing QA `onProgress` facts into
  `presentTaskRail` views; register `/imm-tasks` command; overlay rendering
  reuses `readBackendClaim` + `projectAssuranceState` + a bounded
  `readdirSync` of `docs/plans/*.intent.json` (already dependency-free fs).
- No changes to `runtime/` Kernel modules, Tool schemas, or persisted formats.

### Invariants

- Presentation remains best-effort and non-authoritative: any rendering or
  overlay failure is swallowed after at most one bounded warning (existing
  `notifyOnce`), never blocks or settles a managed operation.
- Footer stays empty; no `setStatus` with defined text, no timers
  (`setTimeout`/`setInterval`), no polling, no HERDR/BEL — the existing
  forbidden-source scan in `tests/pi-canary-work-extension.test.ts` must keep
  passing for all touched files.
- The overlay performs zero authority mutations and never enrolls, routes, or
  executes anything; its data is a point-in-time snapshot with no background
  refresh.
- No raw JSON, digests, capabilities, or unbounded findings appear in Rail or
  overlay default rendering (bounded ids/labels only).

### Failure behavior

- Overlay open failure (renderer throws): one warning notification, command
  returns without state change.
- Missing `docs/plans/` or unreadable sidecar: that entry is skipped; the
  overlay lists what was readable; no error toast per entry.
- QA progress payload absent (older callers): Rail renders exactly as today.

## Compatibility And Rollback

Additive-only: `TaskRailView` gains optional fields; existing callers render
unchanged when fields are absent. No schema, persisted bytes, Tool contract, or
event contract changes. Rollback reverts the two `.pi-extension` files and
focused tests as one unit; ephemeral presentation needs no state repair.

## Scope

- `plugins/immune-brain/.pi-extension/pi-canary-interaction.ts`
- `plugins/immune-brain/.pi-extension/imm-canary-work.ts`
- `tests/pi-canary-work-extension.test.ts` (focused extension tests for the
  new Rail rows, overlay rendering, and forbidden-source scan coverage)
- `docs/specs/task-rail-progress-depth-and-overview.spec.md`

Settled-history CLI view and GitHub carrier views are out of scope (BR-DEC-3,
BR-OUT-2).

## Brainstorm Trace

- BR-REQ-1 -> Result 1, Technical Design (TaskRailView extension).
- BR-REQ-2 -> Result 2, Decisions (`/imm-tasks` overlay).
- BR-DEC-1 -> Result 3, Invariants (projection-only data).
- BR-DEC-2 -> Decisions (on-demand overlay).
- BR-DEC-3 -> Decisions (history exclusion rule).
- BR-OUT-1 -> Invariants (zero authority mutations).
- BR-OUT-2 -> Scope (out of scope).
- BR-OUT-3 -> Invariants (Footer empty, forbidden-source scan).
- BR-DEFER-1 -> deferred; revisit after overlay lands.

## Devil's Advocate Audit

- **Rollback resilience**: the change is ephemeral presentation only; revert
  the two extension files plus tests. No persisted state, no migration, no
  authority bytes. Interruption mid-implementation leaves the current Rail
  behavior for callers that pass no new fields.
- **Verification vanity**: focused tests assert the new Rail rows and overlay
  content via the existing `render(120)` harness (used today for
  `State/Result/Next` and the Final Card), so each assertion fails if the
  renderer stops emitting the row or the overlay stops listing tasks. The
  forbidden-source scan already fails on any reintroduced `setStatus`/timer.
- **Spec dilution**: every manifest ID is traced above; the only narrowing is
  the explicit BR-DEFER-1 deferral and BR-DEC-3 history exclusion, both
  user-confirmed.
