# P2C Drain Drill Record

**Date**: 2026-08-13
**Plan**: docs/plans/2026-08-13-014-feat-assurance-kernel-p2c-pi-default-routing-plan.md (Step 1)
**Spec**: docs/specs/assurance-kernel-v4-p2c-pi-default-routing.spec.md

## Purpose

Prove the drain-only rollback path of the Kernel canary route with a real
Pi TUI walkthrough: a user-confirmed `begin_drain` must transition the
workspace backend claim `active -> draining` unidirectionally (keeping the
TaskRecord and workspace ownership), and a user-confirmed `stop` must
terminalize (task tombstone + workspace release) so v3 routing is restored.
This is the missing promotion precondition for P2C (the parent cutover spec
requires successful restart/rollback drills).

## canary-004 — Complete Drain Drill (PASS)

Sequence, all through the Pi TUI lifecycle extension with fresh
`ctx.ui.confirm` for every privileged action:

| Step | Time (UTC) | Action | Observed state |
|---|---|---|---|
| 1 | 2026-08-13T02:42:38.178Z | `/imm-canary-enroll canary-004` | claim `active` (task canary-004), TaskRecord phase `working`, workspace `current_working: canary-004` |
| 2 | 2026-08-13T02:43:01.095Z | `/imm-canary-authorize canary-004 begin-drain` (user confirm) | claim `lifecycle_status: "draining"`, `updated_at` advanced; TaskRecord phase unchanged (`working`) |
| 3 | 2026-08-13T02:43:20.286Z | `/imm-canary-authorize canary-004 stop` (user confirm) | terminal tombstone `canary-004.backend-claim.json` (`lifecycle_status: "terminal"`, `terminal_phase: "stopped"`, `terminal_event_id: "stop:canary-004:2026-08-13T02:43:20.286Z"`), workspace `current_working: null` (v3 routing restored) |

Draining claim bytes observed after step 2 (workspace claim):

```json
{
  "contract": "assurance_kernel/backend_claim/v1",
  "backend": "kernel",
  "task_id": "canary-004",
  "lifecycle_status": "draining"
}
```

Terminal tombstone observed after step 3:

```json
{
  "contract": "assurance_kernel/task_tombstone/v1",
  "task_id": "canary-004",
  "lifecycle_status": "terminal",
  "terminal_phase": "stopped",
  "terminal_event_id": "stop:canary-004:2026-08-13T02:43:20.286Z",
  "terminalized_at": "2026-08-13T02:43:20.286Z"
}
```

Behavioral assertions satisfied:

- `active -> draining` is unidirectional and user-confirmed (fresh TUI
  confirm; the capability-bound application consumed the user capability).
- Drain does not mutate the TaskRecord (phase stayed `working`).
- Workspace ownership is retained while draining and released on stop.
- Stop terminalizes atomically (tombstone) and restores v3 routing.
- Re-enrollment of canary-004 is blocked by the terminal tombstone.

## Walkthrough Notes — canary-002 and canary-003 (stop-only)

Two earlier drill attempts (`canary-002` at 2026-08-13T02:40:28Z and
`canary-003` at 2026-08-13T02:41:49Z) executed `enroll -> stop` directly:
each produced a `working -> stopped` TaskRecord history entry and a terminal
tombstone, but **neither exercised the `begin_drain` path** (their TaskRecord
history contains no drain-driven transition, and the drain path leaves no
persistent record because `begin_drain` mutates only the workspace claim,
which the stop tombstone supersedes). They are recorded here for
completeness as stop-only walkthroughs; they do not satisfy the drain-drill
precondition and are excluded from the drain evidence. Their intents
(canary-002, canary-003) remain in git history as committed sidecars.

## Reference — canary-001 full lifecycle (context)

canary-001 (2026-08-13T01:40:07Z) completed the full happy path
`enroll -> evidence -> submit_review -> QA assurance -> complete -> done`
with no drain; see its TaskRecord and tombstone under `.imm/tasks/`.

## Conclusion

The drain-only rollback path is proven on a real Pi TUI canary with
user-confirmed `begin_drain` and `stop`. Combined with readiness
`candidate` (zero gaps) and the zero-incident canary-001 lifecycle, the
P2C observation window's evidence conditions are satisfied; final
promotion remains a literal-user approval decision.
