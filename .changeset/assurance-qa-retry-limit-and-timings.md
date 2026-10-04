---
"immune-brain": patch
---

Limit repeated identical QA failures and add opt-in stage timings to `advance_assurance`.

- **QA retry limit:** after two consecutive QA failures on the same snapshot (record revision, intent hash, diff hash) the coordinator returns `blocked` instead of rerunning the descriptors. A changed snapshot, a QA success, or a new session resets the count; host cancellation neither counts nor resets it.
- **Stage timings:** with `IMM_ASSURANCE_TIMINGS=1` (or the `reportTimings` port) advance results carry `timings: { total_ms, stage_ms }` per progress stage. Off by default, so existing result contracts are unchanged.
