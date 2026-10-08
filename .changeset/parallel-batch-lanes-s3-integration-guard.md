---
"immune-brain": minor
---

Guard lane-mode integration with a descriptor rerun (`parallel-batch-lanes` S3). Before the batch branch moves, the runner reruns the deterministic QA descriptors of the child and of every sibling integrated since the lane base against the candidate commit's tree, without checking it out and without recording any Kernel attestation or finding; the batch branch fast-forwards only after they pass. A failed rerun (`batch_integration_check_failed`), a plumbing conflict or an identity mismatch (`batch_integration_conflict`) leaves the batch branch and working tree unmoved, parks the child as `needs_human`, skips its dependents and keeps the Lane and its branch, while a disjoint committed sibling still integrates. Also fixes resume adoption after an interruption between the fast-forward and the state write: the integrated-commit lookup mis-split Git trailers and never matched, so a resumed tick could have committed the child twice.
