---
"immune-brain": patch
---

Give the Claude Code Host the post-settlement GitHub tracker projection the Pi Host already performs, so an opted-in terminal projection no longer depends on which Host settled the task. The step lives in the shared coordinator (`projectTerminalTrackerState`) and both Hosts call it: it derives the projection input only for a fresh claimless done/stopped task with its exact terminal tombstone, forwards to the tracker, and reports a tracker failure as `tracker` beside the authoritative result instead of turning it into evidence, a Loop blocker, or a reason to repeat the settling Kernel mutation. Enrollment still performs no projection.
