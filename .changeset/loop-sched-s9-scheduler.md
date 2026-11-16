---
"immune-brain": minor
---

Schedule Loop work from work item facts (D7): a candidate's scope-overlap check now reads the `scope_hint` of the target's bound TaskIntents (or of the intents its published plan drafted) instead of a field no event carries, and `ready_buffer` counts the work items in `plan_published` instead of a constant `0`. An Issue edit event (E2) now fires only when its title or body changed, compared against a stored content hash, so a new comment no longer escalates; a PR check failure event (E8) carries `head_sha` in its `event_id`, so two failures of one check on different heads no longer share an identity. No user-visible change.
