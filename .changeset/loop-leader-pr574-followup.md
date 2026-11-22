---
"immune-brain": patch
---

Follow-up fixes from PR #574 review:

- Fail closed on unreadable Kernel projections during leader `resolve`: an error or
  exception from `projectAssurance` records `kernel_projection_unreadable:<task_id>` as
  an authority blocker so `resume`, `release` and `replan` are rejected with zero side
  effects while `ask_owner` remains admissible.
- Persist GitHub interaction comment URLs across ticks in daemon `stateDir` and
  capture URLs returned by `editComment` or observed `RawComment.url`, so in-place
  `annotate` and `already_posted` still record `waiting[]` pointers on fresh channel
  instances.
- Propagate `needs_judging: true` when `a18_event_prefilter` or
  `a20_issue_duplicate_pair` falls back to its baseline before a downstream classifier
  decides, so `reconcile` surfaces those decisions to the leader (ADR 0042 Decision 1).
- Surface `loop.roles` diagnostics in `imm-loop status` (text and `--json`
  `role_catalog_diagnostics`), remove unused `READ_ONLY_LOOP_BASES` and retired
  `judging_agent_used` / `"judging_agent"` leftovers, and sync ADR 0041 and ADR 0042.
