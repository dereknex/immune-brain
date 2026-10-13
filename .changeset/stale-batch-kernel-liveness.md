---
"immune-brain": patch
---

`retire_stale_batch` no longer dead-ends on a child the batch record still holds mid-flight after its Kernel run ended outside the batch. A child blocks the disposition only while the Kernel store has no terminal run for it, the confirmation shows each child's Kernel lifecycle, and the retired record keeps every child state untouched.
