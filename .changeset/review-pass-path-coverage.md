---
"immune-brain": minor
---

Require a Review pass verdict to claim every path of the reviewed change set.

- For the review role only, `parseAssuranceVerdict` now requires `approval.inspected_paths`: an array of unique repository-relative path strings. A pass is rejected as `verdict_invalid` when the field is absent, is not an array of strings, duplicates a path, lists a path outside the reviewed change set, or omits any path of it; deleted paths are part of the required set and an empty change set is claimed as an empty array.
- The rejection names the offending paths, keeps the reservation, and follows the existing single-correction path, so the fix is a corrected verdict rather than a re-dispatched reviewer.
- The list is checked at the coordinator and removed before settlement: the Kernel approval and TaskRecord are unchanged, so no schema, persisted record or replay path changes, and the contract id stays `assurance_kernel/assurance_verdict/v2`.
- Rework verdicts and QA-role verdicts still reject the field as unknown. The reviewer prompt, the packaged reviewer definition and the Loop contract state that a path may be listed only after its diff was read.

This converts silent partial Review coverage into an explicit false statement in the verdict. The check proves the reviewer claimed every path, not that it read it; that limit is accepted under BR-DEC-3.
