---
"immune-brain": patch
---

The non-interactive refusal in the Pi batch entry point lives in one helper the
registered tool surface and the batch entry point both call, so the refusal text
and its recovery hint cannot drift between them. The comment that described
`isOwnBatchClaim` while sitting above an unrelated interface moves to the
function's own definition in `runtime/unattended/batch_preflight.ts`, where it
also records the evidence it checks and why `confirmation_time` is deliberately
not part of it.
