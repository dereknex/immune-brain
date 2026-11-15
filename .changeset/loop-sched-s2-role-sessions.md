---
"immune-brain": minor
---

Run every Loop daemon session (judging, clarify, plan, repair) with the profile bound to its own role and a built-in per-role limit table, instead of the positional lane executor leaf. Read-only roles (`judging`, `clarify`, `plan`) never receive `acceptEdits`: they run with the Host read-tool allow-list, deliver their result on stdout, and a Host with no verified read-only mode is refused with `role_readonly_unsupported` before any process starts. The plan session is read-only and the daemon writes the plan artifacts from its structured output. No user-visible change: only session argv and decision records change.
