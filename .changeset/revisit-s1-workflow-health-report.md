---
"immune-brain": minor
---

`revisit` becomes a workflow-health retro over pi session logs. The model-load ranking retired: the ranking table, the review quality-and-score table and the project × author table (`rev/100ed`, `avgSc`, `pass%`) are gone, and rounds/task and finding totals no longer carry a model key. Timestamps are parsed to epoch milliseconds (ISO with any offset, or numeric) with a skipped-line count in the header, `--exclude <substr>` (repeatable) filters sessions beside `--project`, and `--top` is removed. The session reader still records the last editor model as an `author` field on review and finding events.
