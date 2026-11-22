---
"immune-brain": minor
---

Resolve blocked work in place and cap replanning (Slice `S4` of Spec
`loop-leader`). A leader `resolve` item acts only on an `escalated` target and
only across orchestration-level blockers: `resume` returns a transiently
escalated target to its still-running batch without asking the owner, `release`
moves `escalated -> triage`, and `replan` runs a fresh plan session whose
published plan is a new digest (and, for an Initiative, a new plan approval).
Every accepted round increments `WorkItem.replan_rounds`; at three the target is
forced to `ask_owner` with reason `replan_cap_reached`. A pending
`material`/`critical` approval, a breaking Intent revision, an open user
decision, a parked batch or a pending `literal_user` Lane decision rejects
`resume`, `release` and `replan`, and only `ask_owner` is accepted.

`InteractionRequest.context` carries the optional context pack — `blocked_on`,
`tried[]`, `options[{id, label, consequence}]` and `evidence[{label, ref}]` —
sanitized (HTML comments stripped, `@` mentions neutralized) and rendered at
most 8 KiB with a truncation marker. The `github` channel posts it on the
request's own Issue or PR and edits it in place through the new
`annotate(interaction_id, context)` operation; the `local` channel stores it and
`loop_interactions` returns it. One pending advisory question per subject and
binding: a new advisory request supersedes the older one, while a pending
`plan_approval` or `lane_decision` is only annotated — never withdrawn,
superseded, or stripped of its answer semantics. `imm-loop status --json` lists
`waiting[]` `{ target, kind, channel, link }`, and the Status Issue renders a
"Waiting on owner" list of links without question text; a failed post is
reported and leaves local transitions unblocked.
