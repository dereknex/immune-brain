---
"immune-brain": minor
---

Remove every wall-clock bound on Immune-Brain authority.

- **Single-step capabilities (S1):** Kernel authority and Enrollment capabilities no longer carry `expires_at` and are never refused because time passed. They stay one-use and bound to their task, operation, record hash, and nonce. New TaskRecord history entries omit `authority.expires_at`; records that carry it still validate and load.
- **Native confirmation (S1):** the batch gate has no window of its own on either Host. It settles only on the user's answer or the caller's cancellation signal. `IMMUNE_BRAIN_BATCH_TIMEOUT_MS` and the `confirmation_timed_out` reason are removed; setting the variable has no effect.
- **Batch authorization (S1):** the budget is `max_children` and `qa_failure_limit` only. `budget.deadline_at`, the binding's `expires_at`, the state record's `authorization_expires_at`, the default eight-hour deadline, and the `batch_authorization_expired` / `batch_budget_expired` blockers are removed. A batch parked on a foreground Review resumes with no gate however long it waited. Plan-digest drift, a branch change, a moved HEAD lineage, and both budget limits still stop or re-gate the run as before.
- **Older records:** a batch state record that still carries the retired expiry fields is read as if they were absent and is rewritten without them. No migration runs and frozen audit is untouched.
- **Decision records:** ADR-0005 decision 3 and ADR-0008 decision 3, with its rejected alternative, now describe the clockless rule and why the deadline was retired.
