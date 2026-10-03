# External Host summary producer follow-up (H1)

Status: prepared, not filed. This is a local, sanitized note for the external
Magic Context Host maintainer. It creates no repository authority and is not an
Enrollment, Issue, or remote write.

## Observed producer defect

A compaction/summary heading in the external Host stated that later Slices of one
Initiative were enrolled while the Kernel receipts proved only authoring and
publication, with a single first Slice active. The summary therefore claimed
execution state that did not exist.

The failure is a producer-side summary defect in the external Host: summary
generation is owned there, not in this repository. Do not patch project prompts
to compensate for it.

## Boundaries of this repository's side

- The consumer-side protection is S3 of this Initiative: Loop resumes from exact
  Kernel authority facts (task/run identity, lifecycle, artifact state,
  obligation, claim) rather than prose, so a false summary cannot create,
  replay, or advance authority.
- Kernel-owned TaskRecord/QA/Review remain the only authority. No local change
  rewrites Kernel core, the store, or historical audit evidence.
- Closure requires an externally verifiable upstream fix or release plus the
  relevant summary regression; updating local prompts would not close this item.

## Requested external action

Fix summary generation in the external Host so a summary cannot assert a
lifecycle stage (enrolled, assured, completed) that the source records do not
support. A regression check should cover "later Slices reported as enrolled
while only authoring/publication occurred".

## Sanitization

No raw session payloads, article bodies, credentials, or personal paths are
included. The observation is generalized to the lifecycle-stage mismatch.
