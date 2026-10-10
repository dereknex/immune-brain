---
"immune-brain": patch
---

In a lane-mode batch, settling a child inside its Lane no longer closes its Child Issue. The coordinator closes it once, after integrating that child's commit onto the batch branch, and retries a failed close on the next tick; a lost or parked child keeps its Issue open. Serial batches and single tasks are unchanged.
