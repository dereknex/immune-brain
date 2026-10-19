---
"immune-brain": minor
---

A batch authorization now binds each child's frozen acceptance instead of its whole TaskIntent: contract, task id, goal, owner, bound Spec path, and every acceptance item's id, assertion and verification command (executable, argv, cwd). A scope-only or revision-only intent revision no longer fails a running batch with `plan_changed` or refuses its child with `batch_child_intent_changed`. When a child's frozen acceptance changes after confirmation, only that child is parked with `batch_child_authority_changed`, its dependents are skipped, and independent children finish; a change to the child set, order or dependencies still fails as `plan_changed`. `revise_intent` now treats a changed verification command or an added acceptance item as breaking, so it needs breaking-revision approval. Batch records written before this release keep whole-intent comparison. See ADR 0026 and Spec branch-boundary.
