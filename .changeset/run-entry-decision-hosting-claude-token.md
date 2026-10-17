---
"immune-brain": minor
---

On Claude Code, typing `imm-run` now covers the whole run after one confirmation. Enrollment and unattended batch start still open their confirmation dialog once, and a confirmed batch start returns a manifest of each child's task id, risk, scope and verification commands. The literal entry also mints a session- and workspace-bound entry token, so a later stale batch retirement in the same run no longer asks again or needs a second `imm-run`. The token lasts until the run ends, with no time limit; it is dropped at session end and refused from another workspace, another session or after the run pauses at the Stop boundary. Breaking intent revisions, rework exits and Lane delegation still ask you, and push or PR creation are unchanged. See ADR 0025.
