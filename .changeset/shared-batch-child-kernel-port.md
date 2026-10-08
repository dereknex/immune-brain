---
"immune-brain": minor
---

Give unattended batch runs one production child Kernel port (`deepen-authority-seams` D5). A new `runtime/unattended/batch_kernel_port.ts` owns `enrollTask` (through the single Enrollment entry), `projectTask`, `ownsTaskClaim` and `validateBatchAuthorization`; a Host supplies only its own `advanceTask` progression seam. The Pi and Claude adapters both call this shared port instead of each building its own, so Enrollment, projection, resume-ownership re-verification and batch authorization validation cannot drift between Hosts. Git operations leave `BatchRunnerKernelPort` entirely: the runner resolves `BatchRunnerGitPort` once (the injected port, or `createDefaultBatchGitPort` when a Host supplies none) instead of a three-level fallback over optional port members.
