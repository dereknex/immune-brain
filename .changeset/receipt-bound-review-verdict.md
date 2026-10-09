---
"immune-brain": patch
---

Make the reviewer's own result bytes the primary Review submission channel: `submit_review` now applies the host-observed receipt when the verdict is omitted (both hosts), the Pi extension records the reserved reviewer's `Agent` result bytes for receipt-bound submission, and the v4 review attestation binds an optional `reviewer_verdict_sha256` so audit can prove the persisted verdict equals what the reviewer produced. Recovery on a fingerprint mismatch now names the no-verdict resubmission first.
