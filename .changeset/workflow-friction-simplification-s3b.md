---
"immune-brain": patch
---

Lane Executors that stop on an `error` state (a usage limit, a crashed turn) now recover on their own: the batch closes the session and opens a fresh generation from the same entry, at most twice per Kernel revision, then parks the child `lane_executor_error`. herdr-core reports `error` instead of `unknown`.
