---
"immune-brain": minor
---

A Review rework result now names a generalize-or-refute obligation when the same acceptance draws a blocking finding in two consecutive rounds. The result gains an optional `convergence` array of `{acceptance_id, streak, obligation: "generalize_or_refute"}`, computed from the committed record with `acceptanceRepeatSeries`; a null acceptance never appears, and the key is absent otherwise. The Executor guidance and the drive rework step pass it on. The rework round budget, `replan_required` parking, verdict bytes and Review independence are unchanged.
