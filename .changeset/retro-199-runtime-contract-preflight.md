---
"immune-brain": patch
---

A new lane-mode batch compares the Kernel contract identifiers of the coordinator runtime with those of the runtime a Lane Executor loads (shipped as `runtime/kernel/runtime_contracts.json`) and refuses with `batch_runtime_contract_mismatch`, naming both sources, before any Lane is provisioned. A Lane whose state exists in a contract the coordinator cannot read now parks as `batch_lane_contract_mismatch` with the original parse error instead of `batch_lane_lost`.
