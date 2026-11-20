---
"@dereknex/immune-brain": minor
---

Execute accepted leader proposal items behind code guards (Slice `S3` of Spec
`loop-leader`). A legal `next` runs its handler through the daemon's own
dispatch path and moves the work item; `priority` stores `WorkItem.leader_rank`,
used only as a tie-break inside one `SCHEDULE_PRIORITY` class. `shape` runs in
`triage` or `planning` only: `task` is the default, while `initiative` runs the
plan role once and writes the Local carrier `docs/initiatives/<slug>.md` plus
one Kernel-authored TaskIntent per slice, recording `binding.initiative_slug`
so `driving` observes the carrier. `dispatch` starts one catalog role session —
read-only bases in an empty directory, `repair` in the daemon's own PR
worktree — and takes completion from the session record, never its text.
`imm-loop status --json` lists running sessions with `target`, `role`, `base`
and `started_at`. Every refused item journals one reason with zero side
effects: illegal transitions, `execute` without Enrollment authority, `repair`
outside the daemon branch, shape after plan publication, unknown or
over-parallel roles, and spent budgets.

The Tier-3 judging agent is retired: a `needs_judging` outcome applies the D12
point baseline, and `imm-loop reconcile` collects model-skipped decisions and
baselines as leader reconcile candidates instead of starting sessions. Each
pass retires what it reported, so candidates never accumulate; started sessions
— failed ones included — count against `max_dispatches_per_day`, and a session
a dead tick left running is reaped on the next tick instead of blocking its
role forever. A
retired `roles.judging` preset binding is tolerated with one
`deprecated_config_source` diagnostic and never invalidates `agents`. ADR 0042
records the leader plus catalog replacing ADR 0039 Decisions 2, 6 and 7.
