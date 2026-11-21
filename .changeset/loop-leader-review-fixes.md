---
"@dereknex/immune-brain": patch
---

Fix the review findings of the Loop Leader. A `replan` resolve now invalidates the
published plan instead of starting a plan session: it starts no session and reads no
dispatch budget, removes the plan publication, clears the work item's plan binding and
the plan's drafts and Initiative carrier, and returns the item to `triage` with
`replan_rounds` + 1, so the next shape re-plans with the same task ids. A nonterminal
batch (`replan_batch_active`) or a draft or carrier edited since publication
(`replan_draft_changed`) refuses the replan and changes nothing. Initiative
`blocked_by` entries are slice ids resolved to task ids in the carrier, and an
unknown, self or duplicate slice reference is rejected before anything is written.
Shaping an Initiative is all-or-nothing: a failed slice or carrier write removes what
the shape created and never touches a pre-existing file. Annotating a pending
`plan_approval` or Lane decision records its waiting pointer, so `imm-loop status`
lists the item as waiting with a link. An over-long `blocked_on` is cut by bytes in
one pass to a valid UTF-8 prefix. A bound `agents.triage` now warns as a deprecated
config source. The leader's batch-state dependency is renamed from `resumeBatch`, and
the discard host no longer needs an `as never` cast.
