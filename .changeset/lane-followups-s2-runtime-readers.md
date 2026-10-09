---
"immune-brain": patch
---

Make lane-mode readers and guidance accurate. A kernel store-condition rejection of a persisted lane batch now reports its persisted lane children and `handoffs[]` instead of an empty serial plan, the resume plan marks `integrated` and `released` lane children `already_settled` instead of `enrollable`, and the lane report names provision guidance only when a handoff has action `provision`. The lane `needs_human` wording now says the lane batch has stopped, its Lane is kept, and continuing needs a new Batch Authorization; the runner behavior is unchanged. Serial (v1) reports are unchanged.
