---
"immune-brain": patch
---

A headless Lane Executor's breaking intent revision now reaches the Parent (#426 F19). Under `--print` the Host cancels the native gate at once and the Kernel recorded nothing, so the Parent saw no decision and restarted the Executor. The supervisor now marks each headless generation with `IMM_LANE_EXECUTOR=headless`; in that session `approve_breaking_intent_revision` validates the revision, leaves a request bound to the current Lane record and returns `lane_decision_requested` without opening a gate. The Parent's `lane_decision_required` carries `requested.next_intent`, the literal user answers at the Parent's own gate, and the applied decision clears the request. A request older than the current record is ignored.
