---
"immune-brain": patch
---

The Claude Host's post-settlement GitHub tracker projection no longer runs inside the `authorize` try/catch that owns Kernel-mutation rollback: a projection failure that happens after `app.execute` has already committed can no longer restore the staged intent or rethrow an error a caller could read as "the mutation did not happen" and retry. The committed result is returned unchanged, with the tracker failure reported beside it as a retryable observation failure.
