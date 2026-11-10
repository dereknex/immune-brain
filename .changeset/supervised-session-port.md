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
