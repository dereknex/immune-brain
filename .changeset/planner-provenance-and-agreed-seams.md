---
"immune-brain": minor
---

Require a named source for every planned decision and an agreed test seam for every acceptance.

- The Planner contract gains `Decision Provenance`: every Spec decision and every acceptance names exactly one source — an upstream `BR-*` ID, repository evidence with a concrete path, or a delegated technical choice — with or without a Brainstorm manifest. A user-owned decision with no source is a defect that is removed or returned for clarification. Direct Planner entry and delegated technical choices stay legitimate sources, so this adds no `BR-DEC`-only rule.
- `TaskIntent decomposition` now requires each Slice of a multi-TaskIntent Initiative to state what is verifiable when that Slice alone has landed, and forbids an acceptance that needs another unfinished Slice's work. A Slice with no such statement is a horizontal layer slice and is re-cut; a wide mechanical refactor may still be batched behind one final integrate-and-verify Slice. Both rules stay Planner judgment, not a schema field or an Enrollment counting rule.
- `Testing Seam Selection` records the agreed seam of each acceptance in the candidate — the Spec's verification mapping for complex work, the acceptance assertion for simple work — and presents it through the surfaces Enrollment already shows. No confirmation is added: seam selection still must not weaken focused descriptors or create a mandatory user confirmation. Replacing a seam remains an acceptance change under Enrolled Intent Revision.
- The `code-review` role prompt checks delivered tests against each named agreed seam. A missing or silently replaced seam is a finding with `violated.kind: "acceptance"` and the acceptance id as `ref`; an acceptance naming no seam produces no finding, so historical candidates stay valid.
- `docs/reference/planning-quality-gate.md` mirrors the provenance and Slice rules; its packaged copy, the role-prompt mirror, and `agents/immune-brain-reviewer.md` are regenerated.

Contract text and generated mirrors only: no runtime, schema, validator, or gate changed.
