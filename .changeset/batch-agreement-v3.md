---
"immune-brain": minor
---

Add BatchAgreement and Lane record v3 (unified-lane-sessions S3, #570): `authorizeBatch` issues `BatchAgreement` (`confirmation`, `final_verification { required, commands }`, `return_policy checkout_delivery | retain_branch`, `interaction_mode interactive_host | parent_relayed`) refusing unknown fields with `batch_agreement_invalid`; Lane records are `batch_run_state/v3` with agreement policies, `session_provider` null and per-child `session` null until S4, refusing v2 with `batch_record_retired`; completion follows `final_verification.required` and return follows `return_policy` for 1- and 2-child agreements with `plan_source` removed from batch lanes, git, cleanup and run continuation; record-level `rebindBatchChildIdentity` and `hasContiguousLaneRebind` are proven for Initiative children.
