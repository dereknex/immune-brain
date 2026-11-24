---
"immune-brain": patch
---

A paused drive run no longer loses its entry token. Only settlement, `SessionEnd`, an explicit cancel or `/draw-up`/`/clarify` entry, and a lost or terminal bound identity (batch or task identity change, a stopped task, missing Kernel authority) revoke it. Every other pause — a user decision or authorization wait, a blocked Parent, `host_failure`, `review_incomplete`, the third native failure, the 7-stop limit and an interrupted Pi turn — only suspends the run: native gates refuse until a plain reply in the same session (Claude, Pi or Antigravity) resumes it, with no `run_entry_required` and no new `/drive`. A reply and every applied native operation also restore the native retry budget.
