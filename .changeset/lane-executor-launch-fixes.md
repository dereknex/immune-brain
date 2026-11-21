---
"@dereknex/immune-brain": patch
---

Make a Lane Executor session start ready to work. A `claude-code` Executor now opens
and resumes with `--plugin-dir` set to the Claude plugin root the runtime was loaded
from (as Review sessions already do), and its entry is submitted as
`/immune-brain:drive <task_id>`, so it no longer idles on `phase_entry_required` or
fails Review with `batch_runtime_too_old`. A new single-task start that names no
`final_verification` takes the layered `batch.final_verification`, which the native
confirmation lists and the batch records, so single-task batches run the project's
final verification; `drive-batch.md` states the shared resolution order.
