---
"immune-brain": minor
---

Pi now matches Claude Code for `imm-run` entry. A literal `imm-run` input (never extension-sourced input) mints a session- and workspace-bound entry token. Enrollment and unattended batch start still open their confirmation dialog once, and a confirmed batch start returns the same manifest of each child's task id, Slice, risk, scope and verification commands. A later stale batch retirement in the same run opens no dialog and records an entry-token confirmation reference bound to the retired plan digest. The token ends at session shutdown, when the run pauses or settles, and is refused from another session or workspace. Rework exits and breaking intent revisions still ask you. See ADR 0025.
