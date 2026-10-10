---
"immune-brain": patch
---

ADR 0018: a lane batch's native confirmation can also delegate, opt-in and off by default, the approval of a Lane child's breaking Intent revisions that stay inside that child's authorized TaskIntent. The coordinator submits such a revision as `lane_revision`; the runtime applies it in the Lane as an audited delegated approval (`batch-coordinator`, `delegated-batch:<batch_id>@<time>`) or refuses it so the Executor falls back to the user's own gate. When the delegated revision is integrated, the batch reseals `plan_digest` and records both digests, so later children continue without retiring the batch; any other Intent change still fails closed.
