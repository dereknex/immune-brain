---
"immune-brain": minor
---

A Parent that runs inside a Herdr pane now holds each Lane's Executor Host in its own Herdr pane, without asking: it splits a pane rooted in the Lane, starts the allowlisted Host there, submits the `imm-run` entry, and waits on the agent's state as a background command. A pane stopped at a workspace-trust, sign-in or permission dialog is reported to the user and never answered by the Parent; the Parent closes only panes it created. Outside Herdr the earlier behavior is unchanged. The lane-mode `executor` handoff now also carries `lane_path`. The runtime and the `lane-steward` role still name no workspace tool (ADR 0013, revised 2026-10-09).
