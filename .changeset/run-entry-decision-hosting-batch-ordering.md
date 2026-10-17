---
"immune-brain": minor
---

Unattended batches now run critical children like any other child instead of leaving them out, and a Parent with only critical work left no longer falls back to native Parent delivery. Children whose scopes overlap now run one after another in Slice order, even without a declared dependency: a later overlapping child starts only after the earlier one is done, and if the earlier one is frozen the later one is skipped as blocked instead of leaving the batch stuck in `running`. `max_parallel` of 1 now starts the serial runner, the same as leaving it out; 0, negative or non-integer values are still rejected. See ADR 0025 and the run-entry decision hosting Spec (D5, D7, D8).
