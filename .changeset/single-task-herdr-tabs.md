---
"immune-brain": patch
---

Run new single-task Lanes inside Herdr in interactive Executor tabs, using the same Parent supervision as Initiative batches. Persist the execution mode across re-entry, preserve existing runtime-supervised tasks, and keep interactive Lanes after delivery when no trusted process exit is available. Parent decision relay no longer starts a background Executor for an interactive Lane. Frozen Lanes waiting on user decisions remain enrolled and expose the decision in their report. An approved interactive stop records the stopped reason immediately and returns the instruction to close the Executor tab.
