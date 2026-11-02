---
"immune-brain": patch
---

Integrate a Lane commit that merges cleanly onto the batch head when an integrated sibling changed other hunks of the same file, instead of parking it as `batch_integration_conflict`. A candidate whose tree differs from the reproducible merge is still refused.
