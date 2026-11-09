---
"immune-brain": minor
---

Authority Review now runs as a separate CLI process by default. `advance_assurance` returns `review_command` and `review_profile` instead of `agent_params`, and the Parent runs that command in its own shell before `submit_review`; the in-process reviewer stays reachable with `IMMUNE_BRAIN_REVIEW_DISPATCH=subagent` until the next release deletes it. A project without `lanes.review_host` stops Review preparation with `review_profile_required` and one recovery action, retaining its QA settlement. `drive.md`, `drive-batch.md` and the subagent dispatch protocol describe the CLI stage, and ADR 0037 supersedes the primary-Review parts of ADRs 0006, 0017 and 0030.
