---
"immune-brain": patch
---

Stop the unattended batch layer from re-validating `max_parallel` inside the scheduler (`parseMaxParallel` and the record check stay the authority) and merge the two topological traversals of the preflight and the plan projection into one shared helper, each caller keeping its own rejection text.
