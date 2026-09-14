---
"immune-brain": patch
---

Make the Spec binding an enrollment precondition instead of a freeze surprise. A new shared `runtime/kernel/spec_binding.ts` owns the "one scope-bound active Spec and its archive path" predicate; enrollment and its zero-write rehearsal now refuse an intent whose `scope_hint` cannot name that pair, naming every path the intent must add, while freeze-time enforcement is retained unchanged because enrollment cannot observe post-implementation scope drift.
