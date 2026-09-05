---
"immune-brain": patch
---

Settle Claude Host Review from the async Agent transcript

The Claude Code Host reconstructed the Review receipt from the `Agent` tool's
`PostToolUse` result, assuming that result was the reviewer's verdict. This
Claude Code build runs every `Agent` call asynchronously — `run_in_background:
false` is not honoured and there is no synchronous mode — so the result is a
launch receipt (`{"isAsync":true,"status":"async_launched",…}`) and never the
verdict. No Review could be consumed on that Host.

`inspectReview` now recognises the launch receipt, cross-checks the `agentId`
against the `SubagentStart`/`SubagentStop` pair it already observed, and reads
the reviewer's terminal message from the transcript the receipt names, matching
the writing `agentId` per record. There is no fallback to Parent-supplied bytes:
an unreadable or silent transcript fails closed, because an optional weaker path
is one the Parent could force.

A stale `SessionEnd` no longer discards live evidence. A resumed session reuses
its id and hook log, so an end recorded for the previous run could sit ahead of
the current run's events; draining cleared the whole log and stopped there. It
now advances surviving reservations past the end — keeping pre-end events
unusable — and reclaims the log only when nothing followed. `prepareReview`
also drains before taking its cursors.

Adds `tests/claude-review-host-async-agent.test.ts`, whose fixtures are recorded
from Claude Code 2.1.261 rather than reconstructed from the documented shapes.
