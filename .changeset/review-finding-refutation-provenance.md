---
"immune-brain": patch
---

Carry refuted Review findings as derived state with executable counterevidence: a Review rework finding now carries the reviewer's evidence and a Kernel-derived anchor, the new `refute_finding` operation is reachable from both Hosts and binds only a fresh passing QA attestation covering the finding's own acceptance, a re-submitted claim inherits the still-live refutation for its anchor instead of reopening as bare blocking work, and the refutation loses force — without rewriting stored state — as soon as its evidence goes stale for the current revision, intent hash or diff. The TaskRecord parse and append-only update invariants fail closed on anchor/evidence pairs that do not match, counterevidence no QA attestation backs, refuted user-decision or replan findings, and transitions that rewrite finding fields they do not own.
