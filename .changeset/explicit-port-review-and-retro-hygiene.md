---
"immune-brain": minor
---

Require explicit `SupervisedSessionPort` (`herdr`) sessions for Authority Review and CLI Findings Verification (#537, #540), retiring the hidden background `--print` `process` transport fallback and failing closed outside Herdr with `review_transport_unavailable` while preserving QA attestations. Enforce an explicit `root: string` workspace parameter on `withCompletionDelivery` (#538), and filter synthetic Host-injected user turns (`<task-notification>`, skill preambles, `Tool loaded.`, usage-limit resets) from `/immune-brain:revisit` human-resume friction metrics (#539).

A reviewer or verifier session keeps the read-only Claude Code tool boundary (`--tools`, `dontAsk`, user hooks off, the git allowlist and an `Edit` rule for its one output file) and Pi keeps its `--tools` set. A session that stopped without writing its receipt now releases the round with `review_session_aborted` / `verification_session_aborted` instead of waiting forever; one blocked on a dialog stays open and returns a runtime-built `resume_command`. A consumed receipt returns the session's `stop_command`, and outside Herdr the preparation reports `review_transport_unavailable` before a missing Host binary.
