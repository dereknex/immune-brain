---
"immune-brain": patch
---

Move the batch preflight both Host adapters duplicated into one shared projection (`runtime/unattended/batch_preflight.ts`): claim ownership, branch availability, working-tree cleanliness against the authorized child scope, reconstructed recovery children, plan digest, and base HEAD are now decided once below the Host boundary, and the post-confirmation drift check re-runs the same implementations. Each adapter keeps only its confirmation transport, failure envelope, and non-interactive refusal. `findExistingActiveBatch` now filters terminal states and has a single implementation, so a settled batch is no longer treated as active — while the settled record's identity still drives the runner's idempotent terminal replay instead of a parallel run.
