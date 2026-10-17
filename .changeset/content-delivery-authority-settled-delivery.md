---
"immune-brain": minor
---

Settled delivery no longer depends on Git state. A Slice settled done with an unchanged TaskIntent counts as delivered whether its bytes are committed by the user, staged, or left in the working tree; the native Parent has no integrate action, gate, or runtime commit, and prerequisite checks follow settlement. Native Parent final verification binds the scoped content identity instead of a clean tree and HEAD, so equal content survives any user commit, amend, or stash. The `delivery_consolidation` parameter, module, and receipts are retired on both Hosts. Read-only `status` reports out-of-scope staged paths as warnings, and the Claude completion result states the settled content hash and that the user may commit however they prefer.
