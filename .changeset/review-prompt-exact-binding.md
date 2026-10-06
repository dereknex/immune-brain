---
"immune-brain": minor
---

Bind a Claude reviewer start only to a byte-identical reserved prompt.

- The reservation marker stops being an acceptance path. `bindsStart` and the `Agent` `PostToolUse` now compare a present prompt against the reservation's own `dispatchPrompt`, so a dispatch that keeps the matching `operation_id` and `task_id` marker but appends context, truncates, or rewrites the body does not bind, cannot settle, and yields a blocked `submit_review` with the retained-reservation `recovery_action`.
- A start carrying no prompt still binds through the identifiers the hook supplies, because that evidence is not Parent-authored text.
- The packaged Loop contract states that any edit to the reserved prompt forfeits the reservation and that the same envelope must be dispatched unchanged.

Sessions that append context to the reviewer prompt stop settling. That is the intent: context belongs in the Kernel-assembled prompt. The generated Claude bundle matches the runtime source.
