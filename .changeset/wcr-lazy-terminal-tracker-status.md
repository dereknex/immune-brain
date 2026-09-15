---
"immune-brain": patch
---

The Claude Host pays for the post-settlement GitHub tracker projection only when
the call actually settled its task. `withTerminalTracker` reads the Kernel
identity the shared step needs through `settledKernelResult`, which admits the
coordinator's `completed`/`stopped` outcomes and a committed `done`/`stopped`
lifecycle, so an advance, review submission, or privileged mutation that leaves
the task active no longer spends a full projection read on a tracker step that
could not have marked anything.
