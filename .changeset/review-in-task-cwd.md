---
"immune-brain": minor
---

Authority Review and findings verification no longer stop on a directory-trust dialog every round. The brief and the receipt live in an ignored result slot inside the task's working directory (`.imm/state/sessions/<id>/`), so no reviewer argv carries `--add-dir`. The reviewer reads `git diff <base_head> <review_commit>` itself; the evidence manifest file, `manifest_digest`, the provenance self-check and the `REVIEW_CONTRACT_MISMATCH` line are removed, and new Review approvals carry `assurance_kernel/review_revision_identity/v2` (`base_head`, `review_commit`). Persisted v1 identities still validate. Review now requires a TaskRecord v4 base head; re-enroll a v3 task.
