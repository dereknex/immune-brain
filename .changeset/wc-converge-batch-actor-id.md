---
"immune-brain": patch
---

Record one literal-user actor identity instead of two. A survey of the 122 settled records under `.imm/audit/` counted `literal-user` 220 times across 54 records against `user` 4 times in three Claude-Host-era records, so `literal-user` (which the Kernel's own batch validation already named in its error text) is the converged spelling: both Hosts now mint it for a batch or enrollment authorization, and the Kernel canonicalizes the actor where the audit identity is written, so a Host that still supplies the historical spelling is recorded as the literal user.

Nothing is rewritten in place: the reader accepts both spellings, so a settled record or a batch capability issued under the old spelling keeps validating and stays byte-identical, and the batch authorization projection stays faithful to the state it read. The extension's mirrored constant is pinned to the Kernel's by a conformance assertion.
