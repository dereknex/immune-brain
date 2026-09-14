---
"immune-brain": patch
---

Both Host adapters now call one shared authorization flow (`authorizeBatch` in `runtime/unattended/batch_preflight.ts`) after the shared preflight: the ADR-0005 reuse/expiry decision, the literal-user gate, the post-gate claim/drift cascade, and the `BatchAuthorizationBinding` construction live below the Host boundary. The Pi and Claude adapters keep only their own gate transport, confirmation reference, and failure-envelope shape, so a batch decision can no longer drift between the two Hosts.
