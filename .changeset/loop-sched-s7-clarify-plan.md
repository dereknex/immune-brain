---
"immune-brain": minor
---

Give the Loop a `clarify` stage in place of the analysis probe: a clarify result with questions posts exactly one `clarify_question` through the Interaction protocol and parks the work item in `awaiting_input`, and an allowlisted reply re-runs `clarify` with the answer appended and then plans. The framing (`scopes`, `seams`, `risks`, `acceptance`) reaches the plan prompt, a15 maps `clear_single_task` and `needs_initiative_decomposition` to planning (the second with a decomposition instruction) and `needs_clarification` to clarify, and the closed handler catalogue now names `clarify_issue` and `apply_clarify_reply` instead of `triage_issue` and `analyze_codebase`. An approved plan enrolls every intent it names and drives them as one batch, so `intents[0]` is no longer special.
