---
"immune-brain": patch
---

Fix project-owned verification process discovery on Linux: the token search reads procfs instead of invoking `ps` with BSD modifiers, so deterministic QA can prove and complete process cleanup on Linux hosts.

Descendants are attributed by session membership rather than by uid, so a command that drops its privileges while staying in the verification session is still cleaned up, and unrelated system processes with unreadable information can no longer fail every check on an ordinary Linux host.
