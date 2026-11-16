---
"immune-brain": minor
---

Require explicit `SupervisedSessionPort` (`herdr`) sessions for Authority Review and CLI Findings Verification (#537, #540), retiring the hidden background `--print` `process` transport fallback and failing closed outside Herdr with `review_transport_unavailable` while preserving QA attestations. Enforce an explicit `root: string` workspace parameter on `withCompletionDelivery` (#538), and filter synthetic Host-injected user turns (`<task-notification>`, skill preambles, `Tool loaded.`, usage-limit resets) from `/immune-brain:revisit` human-resume friction metrics (#539).
