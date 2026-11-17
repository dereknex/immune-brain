---
"@dereknex/immune-brain": minor
---

Add the resident read-only Loop leader (Slice `S2` of Spec `loop-leader`). Every
`imm-loop` tick compiles a local briefing — open work items, batch summaries,
pending interactions, the last 20 handler and worker outcomes, the role catalog,
owner hints and budget availability — and serializes it canonically. Its digest
is the briefing fingerprint: the tick wakes one bounded read-only leader session
only when that digest differs from the last journaled wake, the leader is not
disabled or out of wakes, and the dispatch budget has room. A wake counts once
against both `loop.budget.max_leader_wakes_per_day` (new: integer 0..500,
default 48, `0` disables the leader) and `loop.budget.max_dispatches_per_day`.
`--dry-run` and `loop.mode: "observe"` compile and report the briefing but never
wake.

The session runs on the catalog `leader` role in a disposable worktree holding
only `.imm-loop/briefing.json` and `.imm-loop/journal-tail.jsonl`, with no GitHub
credential, and answers with `loop_leader_proposal/v1`. The daemon parses it
strictly: a non-JSON reply, a wrong contract or a stale fingerprint refuses the
whole proposal, while an unknown target, unknown handler, unknown role, a brief
over 16 KiB or `ask_owner` without context refuses only that item. Accepted items
and refusals are journaled under `.imm/state/loop/leader/journal.jsonl` (mode
0600, rotated at 2 MiB keeping one previous file). `S2` executes nothing:
proposals have no effect until `S3`, so there is no user-visible change yet, and
deleting `leader/` costs exactly one wake.
