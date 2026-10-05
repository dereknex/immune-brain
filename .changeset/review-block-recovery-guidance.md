---
"immune-brain": minor
---

Tell a blocked Claude `submit_review` how to recover on the same Host, and stop claiming every Host runs reviewer Agents in the foreground.

- A blocked Claude Review result carries one `recovery_action`: a released reservation starts a fresh reviewer through `advance_assurance`; a reservation still waiting asks for the same reviewer's verdict; a mismatched parent verdict must be resubmitted exactly.
- Continuing a finished reviewer is rejected as a duplicate `SubagentStop`, and the Loop contract plus the reviewer definition forbid re-prompting one, including through SendMessage.
- The packaged Loop contract states that a Claude `Agent` call returns an asynchronous launch receipt, which is normal, and that the reserved prompt is dispatched unchanged.
