---
"immune-brain": minor
---

Inside Herdr the Parent now drives each Lane Executor session through the new
`imm-session` command and the Supervised Session Port (ADR 0038) instead of
spelling `herdr` commands itself. The Herdr adapter keeps the same tabs, focus
rule, dialog handling and event-driven wait, pins Herdr protocol 22, and fails
closed when Herdr is unavailable. Kernel and batch behavior are unchanged.
Antigravity is now a Herdr Executor Host (kind `agy`) alongside Claude Code and
Pi, matching the hosts the Lane configuration already accepts.
`imm-session --provider herdr-core` adds a herdr-core adapter on the `hc` CLI;
the Loop contract does not use it yet.
After the first live run: Herdr sessions are owned by a token in the tab label
(another pane in the Parent's workspace is refused), instructions also reach a
`done` session (the batch runner accepts `session_state: "done"`), `--resume`
restarts an exited Host in the same Herdr tab, and `create --env` passes extra
Host environment.
