---
"immune-brain": minor
---

`start_unattended_batch` now reads a Local Initiative. When `docs/initiatives/<slug>.md` exists, both Hosts project the batch plan from that file with no GitHub operation; every other slug is still read from its GitHub Parent Issue. Each `## <slice-id>: <result>` section names exactly one Task under `Tasks:` and may add one `Blocked by: <task-id>, <task-id>` line. A Slice with no Task or several, a dependency outside the Initiative, or a symlinked carrier refuses the plan before any confirmation. The plan digest is the same as for a GitHub Initiative with the same Tasks and dependencies.
