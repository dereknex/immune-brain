---
"immune-brain": patch
---

Converge three Host divergences onto the safer branch. Restoring a staged TaskIntent is now one shared, verifying implementation, so a restore that leaves the bytes or the index inconsistent fails closed on both Hosts instead of only on Pi. The bounded native-confirmation deadline is shared too: an unanswered confirmation ends on the same `IMMUNE_BRAIN_BATCH_TIMEOUT_MS` setting with the same default, and reports a stable timeout reason rather than a cancellation. Claude now imports the shared authorization-operation derivation instead of re-deriving it inline, so the mapping from Kernel readiness cannot drift between Hosts.
