---
"immune-brain": patch
---

Bind a Batch Authorization's expiry to the budget deadline the literal user confirmed instead of a fixed ten-minute window. A batch parked on a foreground Review inside its confirmed budget no longer lapses and demands a second native gate, while the fail-closed expiry, deadline, clock, and renewal checks are unchanged on both Hosts.
