---
"immune-brain": patch
---

Repair single-task batch finalization. A verified task whose checkout is blocked now persists a readable `needs_human` batch with the real reason and the passing result nested in the final report, instead of failing on the completed-only top-level proof. A failed, timed-out or stale final verification keeps the integration but never delivers or cleans up. A replay reuses only an unchanged validated pass, reconciles an already applied delivery only when its full identity (content and modes, or ref lineage) matches, and parks any changed bytes.
