---
"immune-brain": minor
---

Give Enrollment a single entry (`deepen-authority-seams` D3). `runtime/kernel/enrollment.ts` exports `enrollTask`, the one production path that issues the capability for a supplied binding, runs the zero-write rehearsal, calls the optional caller checkpoint, and commits. A not-ready rehearsal rejects through a single shared `Kernel enrollment rehearsal failed: <blockers>` error; a declined checkpoint returns a `cancelled` outcome with zero Kernel writes; once commit has started, cancellation has no effect, and replay of a lost Enrollment keeps today's behavior. The Claude enroll path, the Claude batch child port, the Pi enroll Tool and the Pi batch child port all call this entry instead of each sequencing rehearsal and commit themselves. `runEnrollmentRehearsal` stays exported as the zero-write precheck for tests and diagnostics.
