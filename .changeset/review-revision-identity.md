---
"immune-brain": patch
---

Publish the full Review revision identity from the Claude Host

`submitReview` re-derives the Review revision and compares `base_head`,
`review_commit`, `review_tree` and `manifest_digest` against the reservation. The
Claude Host adapter returned only the commit identity, so the last comparison put
a real digest against `undefined` and every TaskRecord v4 submission stopped with
`review_preparation_failed: Review revision changed before submission` — an
unfalsifiable failure, because the revision it named had not moved. No Review
could settle on that Host.

The adapter now recomputes the manifest and republishes the same four fields the
Review snapshot binds, using the outcomes of the settled QA attestation. The Pi
adapter already recomputed the manifest but drew its outcomes from a preflight
stand-in, which matched the settled attestation only because deterministic QA
happens to write that exact summary; it now reads the attestation too, so both
hosts agree by construction rather than by coincidence.

Adds `tests/review-revision-identity-conformance.test.ts`, which drives a real
repository and a real TaskRecord through `advance` and `submitReview`. A port
double cannot express this defect, which is why the existing coordinator suites
never saw it.
