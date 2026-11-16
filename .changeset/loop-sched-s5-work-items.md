---
"immune-brain": minor
---

Track one rebuildable work item per Loop target under `.imm/state/loop/work_items/` with the D5 state machine: `ready-for-agent` without a published plan now routes to `planning` instead of jumping to `enroll_and_drive`, an illegal handler transition is refused and recorded, and a level event (E5, E6, E8, E9, E11) is judged only when its fact fingerprint changed. Edge events keep `event_id` deduplication. No user-visible change. When one work item file is lost from a store that still has others, that target is rebuilt alone from its published plan or active Kernel run instead of restarting at `triage`.
