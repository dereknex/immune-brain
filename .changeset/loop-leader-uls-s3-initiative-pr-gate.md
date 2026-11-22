---
"immune-brain": minor
---

Gate the daemon's Initiative pull request on the whole batch (Slice `S3` of Spec
`loop-leader-uls-alignment`). `batchDeliveryEvidence` reads a v3 batch record and
passes only when it is `completed` with a passing final verification, the retained
`imm/<slug>` branch still contains the batch commit, and every child is integrated
with a tracked `.imm/audit/` pair at that commit; each refusal names its reason.
`open_pr` uses it when the work item records an Initiative batch and opens one PR
from `imm/<slug>` listing every child's acceptance ids and audit digest. A repeated
E13 finds the existing PR by head branch. Single-task delivery from
`refs/heads/imm/<task_id>` is unchanged. This amends ULS Spec D13 as recorded in
the new Spec.
