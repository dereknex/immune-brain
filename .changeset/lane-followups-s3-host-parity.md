---
"immune-brain": patch
---

Align the two Hosts on the lane-mode tool input. A `start_unattended_batch` call with `lane_offers` and no `max_parallel` now resumes the recorded lane batch with its recorded `max_parallel` on Claude Code and Pi, and is refused before any gate when there is no recorded active lane batch. The Pi `max_parallel` schema now refuses a non-integer or sub-1 value at the schema, as Claude Code does, and the Pi loop surface accepts the `lane-supply` route target.
