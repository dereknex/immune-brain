---
"immune-brain": minor
---

One function in `runtime/workspace_scope.ts` now computes a TaskRecord's delivery identity: `taskDeliveryIdentity` selects the revision family for a v4 record with `git_base_head`, throws for a v4 record without it, and keeps the index family for pre-v4 records. The Claude adapter, the Pi adapter, `commands/kernel.ts` and `batch_reconfirmation.ts` call it instead of branching on `record.contract` themselves, and `projectAssurance` plus both Kernel application modules default to it when no `diffProvider` is supplied — a supplied provider still overrides it, so the existing test seam is unchanged. Batch plan reconfirmation keeps its v4-only refusal and only delegates the computation.
