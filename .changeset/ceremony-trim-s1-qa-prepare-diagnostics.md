---
"immune-brain": patch
---

A failed QA `prepare` stage (timeout, nonzero exit or output limit) now returns `prepare_observation` in the `advance_assurance` Tool result on both Hosts: the fixed execution conditions (isolated delivery, no worktree `node_modules`), the declared timeout, and a stderr tail of at most 2048 bytes taken from the end with control characters other than newline and tab removed. The failure text also states that a reproduction in the live worktree is not equivalent. A failing check stage still returns no output text, and the tail is never part of `QaCheckDiagnostic`, batch failure facts or the stored TaskRecord. The Loop contract states the stage-specific rule in place of the blanket no-output sentence (#216).
