---
"immune-brain": major
---

Authority Review is CLI-only. The `IMMUNE_BRAIN_REVIEW_DISPATCH` switch is gone,
along with the subagent Review path it could re-enable: no Host reserves, blocks
or observes a reviewer `Agent` dispatch any more, the generated
`immune-brain-reviewer` agent definition is no longer shipped, and a
`REVIEWER_DISPATCH_RULES` definition no longer exists. `advance_assurance`
always returns `review_command`, so a project without `lanes.review_host` stops
with `review_profile_required` instead of falling back to an Agent dispatch.
Findings verification and `immune-brain-review-verifier` are unchanged.
