---
"immune-brain": patch
---

Make `scripts/verify-batch-completion.ts` verify a completed lane-mode batch (`batch_run_state/v2`) instead of failing `read_failed`. It reads the lane report (`handoffs[]`), checks the batch-branch commits in integration order against their trailer, subject, single-parent lineage, audit pair and scope, and reports a self-contradicting v2 record as `state_report_mismatch`. Serial (v1) verification is unchanged.
