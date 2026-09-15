---
"immune-brain": patch
---

ADR-0009 records the accepted decision that the three settled Slices frozen on
bun `1.3.14` — `wc-host-neutral-contract-tool-names`, `wc-behavioral-guardrails`,
and `wc-batch-resume-single-gate` — permanently lose their frozen re-verification
path once the host runner moved to `1.4.2`, which
`runtime/assurance/verification.ts`'s `assertRunnerCompatible` now refuses. Their
`1.3.14` descriptors stay as historical evidence, and protection for shipped
Slices is `main`'s standing test suite rather than a re-openable frozen artifact.
