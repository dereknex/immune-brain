---
"immune-brain": patch
---

ADR-0008 now matches the batch runtime it describes and is settled. Its
reuse/expiry decision is attributed to the shared implementation that owns it —
`projectBatchPreflight`, `authorizeBatch`, and `projectBatchDrift` in
`runtime/unattended/batch_preflight.ts`, with the blocker names it reuses nothing
for — instead of the pre-extraction claim, and the record states the shipped
decision (status `accepted`) with the persisted-capability and widened-window
options kept as rejected alternatives.
