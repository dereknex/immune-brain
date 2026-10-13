---
"immune-brain": minor
---

Only `imm-run` refuses an action at phase entry. A model Skill call for `imm-planner` or `imm-brainstorm` on Claude Code no longer revokes the session's run entry: it writes nothing to the phase-entry store, so an Enrollment later in the same session opens its native confirmation without a fresh `/imm-run`. A plan entry the user types still revokes the run entry. The revision-owner guard is removed on both Hosts: a file edit inside the active task's scope is no longer denied from a plan-entry session, and the reason code `revision_owner_required` no longer exists. `enroll`, `start_unattended_batch` and the `imm-run` Skill still require a live literal run entry. ADR 0022 records the decision and supersedes the revocation rule of ADR 0020 (#230).
