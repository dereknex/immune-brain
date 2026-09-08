---
"immune-brain": patch
---

Stop a Managed task from Pi with one native confirmation

Kernel already settled tasks on `stop`, but the Pi extension exposed no user
reachable entry, so a task holding the workspace claim could not be released
without editing `.imm` state by hand.

`imm_kernel_canary` accepts `action: {op: request_stop}` for an eligible
`active` or `frozen` task, including one waiting on Review or a replan gate.
The Host opens one native confirmation, builds the stop authority itself, and
the Kernel performs the existing stop settlement: terminal TaskRecord,
terminal proof, archived planning artifacts and a released claim. Unrelated
and implementation files are preserved.

Cancelling, timing out, aborting, or closing the session before the commit
mutates nothing, and a stop preparation failure releases the invocation so the
same session can retry. Concurrent Assurance work and a snapshot that moved
under the request are rejected rather than overwritten; a confirmed stop
invalidates outstanding Review resources so a late verdict cannot rewrite
terminal evidence. A delivery failure after the commit is reported separately
and does not undo the stop.
