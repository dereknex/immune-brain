---
"immune-brain": patch
---

Retire the batch redo re-issue path that no runtime caller used after Lanes became retained: a durable redo grant is still restored and still bounds a parked child, but nothing can spend one while Lane recreation is disallowed.
