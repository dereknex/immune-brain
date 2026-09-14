---
"immune-brain": patch
---

Make one frozen table (`runtime/unattended/batch_reasons.ts`) the only producer of batch-gate reason and recovery prose on both Hosts, so the same condition reads identically by construction instead of because two copies still agree. Every migrated message keeps its exact text and recovery action; only a Host's own transport form (a returned envelope versus a thrown native error) stays with that Host. The dual-host parity assertions that compared the two adapters' reason strings are retired and restated as the property that can still fail: no adapter may carry a copy of the table's prose again.
